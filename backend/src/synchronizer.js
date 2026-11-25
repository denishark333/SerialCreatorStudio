import { parallel } from './async.js';
import { randomUUID } from 'node:crypto';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { period } from './reports.js';
import { fail } from './errors.js';
/** Reasons where a person is waiting for the result: these jobs go ahead of automatic ones. */
const URGENT = new Set(['connection', 'manual']);
const RANK = { high: 0, normal: 1, low: 2 };
/**
 * A sync runs in two jobs:
 * - the main job (no `kind`): channels, catalog, formats, channel analytics, playlists and comments — what the
 *   screens need — finishes quickly and frees its slot;
 * - a `kind: 'videos'` job with the per-video reports (the long part), queued with low priority. It inherits the
 *   main job's errors and warnings, so the latest job still summarizes the whole sync.
 */
const isVideos = job => job.kind === 'videos';
const HOUR = 3600000;
/**
 * How often each kind of YouTube data is collected automatically. The sources themselves do not change faster:
 * YouTube Analytics is published with a 1-2 day delay. A new connection or a manual "Sincronizar" collects
 * everything. Twitch/Kick channels and lives are collected on every tick (`intervalMs`); Twitch events arrive in
 * real time through EventSub.
 * - catalog: videos, statistics, playlists, memberships and new comments (incremental) — `catalogMs`;
 * - analytics: channel reports, formats and per-video reports of the period — `analyticsMs`;
 * - comments-full: every comment thread again (edited/removed replies) — `commentsFullMs`.
 * The last successful run of each phase is kept per channel in `syncMarks`.
 */
const markId = (channelId, phase) => channelId + '|' + phase;
/** One durable queue for the entire workspace. Never publishes or moderates. */
export function createSynchronizer({
  repository,
  youtube,
  streams = null,
  studio,
  reports,
  memberships = null,
  intervalMs = 30 * 60 * 1000,
  catalogMs = 6 * HOUR,
  analyticsMs = 24 * HOUR,
  commentsFullMs = 24 * HOUR,
  manualCooldownMs = 15 * 60 * 1000,
  concurrency = 4,
  workspaceConcurrency = 2,
  progressFlushMs = 5000,
  now = () => Date.now(),
  logger = console,
}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error('SYNC_CONCURRENCY must be between 1 and 8');
  if (!Number.isInteger(workspaceConcurrency) || workspaceConcurrency < 1 || workspaceConcurrency > 8)
    throw new Error('SYNC_WORKSPACES must be between 1 and 8');
  /** Running jobs: job id → { workspaceId, low, task }. */
  const active = new Map();
  let stopped = false,
    timer = null,
    flushTimer = null;
  const snapshot = () => repository.snapshot();
  /**
   * Progress (phase, completed videos, warnings) changes once or twice per video. It is kept here and written
   * at most every `progressFlushMs`: each repository write copies and persists the whole state. status()
   * shows it live. Errors, the claim and the final result are still written immediately (`update`).
   */
  const progress = new Map();
  const withProgress = job => (progress.has(job.id) ? { ...job, ...progress.get(job.id) } : job);
  // Values are copied: the repository freezes what enters the state, and execute() keeps pushing to its
  // own `errors`/`warnings` arrays.
  function report(id, values) {
    progress.set(id, { ...progress.get(id), ...structuredClone(values), updatedAt: new Date(now()).toISOString() });
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushProgress().catch(error =>
        logger.error({ code: 'SYNC_PROGRESS_PERSIST_FAILED', error: error?.message ?? String(error) }),
      );
    }, progressFlushMs);
    flushTimer.unref?.();
  }
  function flushProgress() {
    if (!progress.size) return Promise.resolve();
    const pending = new Map(progress);
    progress.clear();
    return repository.update(s => {
      for (const [id, values] of pending) {
        const job = (s.syncJobs ?? []).find(j => j.id === id);
        if (job) Object.assign(job, values);
      }
    });
  }
  function status(w) {
    const s = snapshot();
    const jobs = (s.syncJobs ?? [])
      .map((j, index) => ({ j, index }))
      .filter(({ j }) => j.workspaceId === w)
      // Newest first; jobs created in the same millisecond (a main job and its per-video job) keep queue order.
      .sort((a, b) => b.j.createdAt.localeCompare(a.j.createdAt) || b.index - a.index)
      .map(({ j }) => withProgress(j));
    return {
      running: jobs.find(j => j.status === 'running') ?? null,
      queued: jobs.filter(j => j.status === 'queued'),
      // A queued per-video job must not hide the finished main job (the screen would show neither state).
      latest: jobs.find(j => j.status !== 'queued') ?? jobs[0] ?? null,
      intervalMinutes: intervalMs / 60000,
      cadence: { catalogHours: catalogMs / HOUR, analyticsHours: analyticsMs / HOUR },
      manualCooldownMinutes: manualCooldownMs / 60000,
      concurrency,
    };
  }
  async function enqueue(w, params = new URLSearchParams(), { force = false, reason = 'automatic' } = {}) {
    const urgent = URGENT.has(reason);
    const range = period(params),
      s = snapshot();
    if (!s.workspaces.some(v => v.id === w)) fail(404, 'WORKSPACE_NOT_FOUND', 'Conecte um canal primeiro.');
    if (!s.channels.some(c => c.workspaceId === w && ['youtube', 'twitch', 'kick'].includes(c.dataSource))) return null;
    const result = await repository.update(state => {
      if (!state.workspaces.some(v => v.id === w)) fail(404, 'WORKSPACE_NOT_FOUND', 'Estúdio excluído.');
      state.syncJobs ??= [];
      const previous = state.syncJobs
        .filter(j => j.workspaceId === w && j.from === range.from && j.to === range.to && !isVideos(j))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const pending = previous.find(j => ['running', 'queued'].includes(j.status));
      // Someone is waiting for this studio: an automatic job already queued is promoted, not duplicated.
      if (pending?.status === 'queued' && urgent && pending.priority !== 'high')
        Object.assign(pending, { priority: 'high', reason, updatedAt: new Date(now()).toISOString() });
      if (pending) return pending;
      if (reason === 'manual' && force && manualCooldownMs) {
        const last = previous.find(j => j.reason === 'manual');
        const wait = last ? Date.parse(last.createdAt) + manualCooldownMs - now() : 0;
        if (wait > 0) {
          const minutes = Math.ceil(wait / 60000);
          fail(
            429,
            'SYNC_COOLDOWN',
            `Você sincronizou há pouco. Os dados já estão atualizados; tente de novo em ${minutes} min.`,
            { retryAt: new Date(now() + wait).toISOString() },
          );
        }
      }
      const recent = previous.find(
        j => ['completed', 'partial', 'failed'].includes(j.status) && now() - Date.parse(j.finishedAt) < intervalMs,
      );
      if (recent && !force) return recent;
      const job = {
        id: randomUUID(),
        workspaceId: w,
        ...range,
        status: 'queued',
        reason,
        priority: urgent ? 'high' : 'normal',
        phase: 'queued',
        createdAt: new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString(),
        completedVideos: 0,
        totalVideos: 0,
        errors: [],
        warnings: [],
      };
      const active = state.syncJobs.filter(j => ['queued', 'running'].includes(j.status));
      if (active.filter(j => j.workspaceId === w).length >= 10)
        fail(429, 'SYNC_QUEUE_FULL', 'Aguarde as sincronizacoes pendentes.');
      state.syncJobs = [
        ...active,
        ...state.syncJobs
          .filter(j => !['queued', 'running'].includes(j.status) && now() - Date.parse(j.createdAt) < 7 * 86400000)
          .slice(-30),
      ];
      state.syncJobs.push(job);
      return job;
    });
    void drain();
    return result;
  }
  /** Durable write; also saves any progress of this job that was not written yet. */
  async function update(id, values) {
    const unsaved = progress.get(id);
    progress.delete(id);
    await repository.update(s => {
      const job = s.syncJobs.find(j => j.id === id);
      if (job) Object.assign(job, unsaved, structuredClone(values), { updatedAt: new Date(now()).toISOString() });
    });
  }
  function lastRun(channelId, phase) {
    const at = (snapshot().syncMarks ?? []).find(m => m.id === markId(channelId, phase))?.at;
    return at ? Date.parse(at) : 0;
  }
  async function mark(w, channelId, phases) {
    if (!phases.length) return;
    const at = new Date(now()).toISOString();
    await repository.update(s => {
      if (!s.channels.some(c => c.workspaceId === w && c.id === channelId)) return;
      s.syncMarks ??= [];
      for (const phase of phases) {
        const id = markId(channelId, phase);
        const row = s.syncMarks.find(m => m.id === id);
        if (row) Object.assign(row, { workspaceId: w, at });
        else s.syncMarks.push({ id, workspaceId: w, channelId, phase, at });
      }
    });
  }
  async function execute(job) {
    const w = job.workspaceId,
      p = new URLSearchParams({ from: job.from, to: job.to });
    const errors = [],
      warnings = [];
    let completed = 0;
    const step = async (phase, action) => {
      if (errors.length >= 5)
        throw new Error('Coleta interrompida após falhas repetidas; consulte os erros e tente novamente.');
      if (stopped) throw new Error('SYNC_STOPPED');
      report(job.id, { phase, completedVideos: completed });
      try {
        return await action();
      } catch (e) {
        errors.push({ phase, code: e.code ?? 'SYNC_FAILED', message: e.message });
        await update(job.id, { errors });
        return null;
      }
    };
    const claimed = await repository.update(s => {
      const current = s.syncJobs.find(j => j.id === job.id);
      if (!current || current.status !== 'queued' || current.workspaceId !== w) return false;
      if (s.workspaces.find(v => v.id === w)?.mergedInto) {
        // Never left queued: drain() would pick the same job again right away.
        Object.assign(current, { status: 'cancelled', phase: 'Estudios unidos' });
        return false;
      }
      Object.assign(current, { status: 'running', startedAt: new Date(now()).toISOString() });
      return true;
    });
    if (!claimed) return;
    if (isVideos(job)) {
      errors.push(...structuredClone(job.errors ?? []));
      warnings.push(...structuredClone(job.warnings ?? []));
      return videoPhase();
    }
    // Someone asked for this sync (new connection, "Sincronizar"): everything is collected again.
    const refresh = URGENT.has(job.reason);
    const due = (channelId, phase, ms) => refresh || now() - lastRun(channelId, phase) >= ms;
    let analyticsRan = false;
    const channels = snapshot().channels.filter(
      c => c.workspaceId === w && ['youtube', 'twitch', 'kick'].includes(c.dataSource),
    );
    await parallel(channels, concurrency, async channel => {
      if (channel.platform !== 'YouTube') {
        const result = await step('Canal e lives - ' + channel.name, () =>
          streams ? streams.sync(w, channel.id) : Promise.reject(new Error('Conector indisponível.')),
        );
        if (result?.warnings) warnings.push(...result.warnings.map(v => ({ ...v, channelId: channel.id })));
        return;
      }
      const analyticsPhase = 'analytics:' + job.from + ':' + job.to;
      const catalogDue = due(channel.id, 'catalog', catalogMs),
        analyticsDue = due(channel.id, analyticsPhase, analyticsMs),
        commentsFull = due(channel.id, 'comments-full', commentsFullMs),
        commentsDue = commentsFull || catalogDue;
      if (analyticsDue) analyticsRan = true;
      const done = [];
      if (catalogDue) {
        // Each source page has a persisted cursor; the next worker attempt resumes it.
        let catalog;
        do {
          catalog = await step('Catálogo · ' + channel.name, () => youtube.sync(w, channel.id));
        } while (catalog && !catalog.complete && !stopped);
        if (catalog?.complete) done.push('catalog');
      }
      const sections = await Promise.allSettled([
        ...(memberships && catalogDue ? [memberships.sync(w, channel.id)] : []),
        (async () => {
          if (!analyticsDue) return;
          const formats = await step('Formatos · ' + channel.name, () => studio.classify(w, channel.id, p));
          const report = await step('Analytics · ' + channel.name, () => reports.sync(w, channel.id, p));
          if (report)
            for (const [section, value] of Object.entries(report.sections))
              if (!['available', 'no_data'].includes(value))
                warnings.push({ channelId: channel.id, section, status: value });
          if (formats !== null && report) done.push(analyticsPhase);
        })(),
        (async () => {
          if (!catalogDue) return;
          let playlists;
          do {
            playlists = await step('Playlists · ' + channel.name, () => studio.syncPlaylists(w, channel.id));
          } while (playlists && !playlists.complete && !stopped);
          for (const pl of (snapshot().playlists ?? []).filter(
            v => v.workspaceId === w && v.channelId === channel.id,
          )) {
            let value = pl;
            while (value?.nextPageToken && !stopped)
              value = await step('Itens da playlist · ' + pl.title, () => studio.morePlaylist(w, pl.id));
          }
        })(),
        (async () => {
          if (!commentsDue) return;
          let comments;
          if (commentsFull) {
            do {
              comments = await step('Comentários · ' + channel.name, () => reports.syncComments(w, channel.id));
            } while (comments && !comments.complete && !stopped);
            if (comments?.complete) done.push('comments-full', 'comments');
          } else {
            comments = await step('Comentários novos · ' + channel.name, () =>
              reports.syncComments(w, channel.id, { mode: 'incremental' }),
            );
            if (comments) done.push('comments');
          }
        })(),
      ]);
      await mark(w, channel.id, done);
      const failed = sections.find(v => v.status === 'rejected');
      if (failed) throw failed.reason;
    });
    // Per-video reports follow the analytics cadence; without it there is nothing new to collect.
    const total = analyticsRan
      ? snapshot().contents.filter(v => v.workspaceId === w && v.dataSource === 'youtube').length
      : 0;
    const finished = new Date(now()).toISOString();
    const unsaved = progress.get(job.id);
    progress.delete(job.id);
    await repository.update(s => {
      const current = s.syncJobs.find(j => j.id === job.id);
      if (current)
        Object.assign(current, unsaved, {
          status: errors.length ? 'partial' : 'completed',
          phase: total ? 'Dados principais concluídos · relatórios por vídeo na fila' : 'Concluído',
          finishedAt: finished,
          updatedAt: finished,
          errors: structuredClone(errors),
          warnings: structuredClone(warnings),
        });
      if (!total || !s.workspaces.some(v => v.id === w)) return;
      // A newer main job replaces the per-video job of the same period still waiting from an earlier one.
      for (const old of s.syncJobs)
        if (
          isVideos(old) &&
          old.workspaceId === w &&
          old.from === job.from &&
          old.to === job.to &&
          old.status === 'queued'
        ) {
          old.status = 'cancelled';
          old.phase = 'Substituída por uma coleta mais recente';
        }
      s.syncJobs.push({
        id: randomUUID(),
        kind: 'videos',
        parentId: job.id,
        workspaceId: w,
        from: job.from,
        to: job.to,
        status: 'queued',
        reason: job.reason,
        priority: 'low',
        phase: 'Relatórios por vídeo na fila',
        createdAt: finished,
        updatedAt: finished,
        completedVideos: 0,
        totalVideos: total,
        errors: structuredClone(errors),
        warnings: structuredClone(warnings),
      });
    });
    void drain();
    return;

    /** Per-video reports for every YouTube content of the workspace (the `kind: 'videos'` job). */
    async function videoPhase() {
      const contents = snapshot().contents.filter(v => v.workspaceId === w && v.dataSource === 'youtube');
      await update(job.id, { totalVideos: contents.length });
      await parallel(contents, concurrency, async video => {
        if (stopped) throw new Error('SYNC_STOPPED');
        const cached = (snapshot().videoReports ?? []).find(
          r => r.workspaceId === w && r.contentId === video.id && r.from === job.from && r.to === job.to,
        );
        if (
          !cached ||
          now() - Date.parse(cached.fetchedAt) >= analyticsMs ||
          ['manual', 'connection'].includes(job.reason)
        ) {
          const value = await step('Relatórios · ' + video.title, () => studio.syncVideo(w, video.id, p));
          if (value && Object.values(value).some(v => v && typeof v === 'object' && /quota/i.test(v.reason ?? '')))
            throw new Error('Coleta interrompida: quota do YouTube esgotada.');
          if (value)
            for (const section of ['summary', 'daily', 'retention', 'traffic', 'revenue'])
              if (!['available', 'no_data'].includes(value[section].status))
                warnings.push({ contentId: video.id, section, status: value[section].status });
        }
        completed++;
        report(job.id, { completedVideos: completed, warnings });
        await yieldEventLoop();
      });
      await update(job.id, {
        status: errors.length ? 'partial' : 'completed',
        phase: 'Concluído',
        finishedAt: new Date(now()).toISOString(),
        errors,
        warnings,
        completedVideos: completed,
      });
    }
  }
  async function run(job) {
    try {
      await execute(job);
    } catch (e) {
      await update(job.id, {
        status: stopped ? 'queued' : 'failed',
        phase: stopped ? 'Retomar ao iniciar' : 'Falha',
        finishedAt: new Date(now()).toISOString(),
        errors: [
          ...(snapshot().syncJobs.find(j => j.id === job.id)?.errors ?? []),
          { code: 'WORKER_ERROR', message: e.message },
        ],
      });
    }
  }
  /**
   * Starts queued jobs, oldest first (jobs someone is waiting for — a new connection or a manual
   * "Sincronizar" — before automatic ones), up to `workspaceConcurrency` at once and never two of the same
   * workspace: a large channel no longer holds every other studio's sync behind it.
   */
  function drain() {
    if (stopped) return;
    while (active.size < workspaceConcurrency) {
      const busy = new Set([...active.values()].map(v => v.workspaceId));
      const ready = (snapshot().syncJobs ?? []).filter(
        j => j.status === 'queued' && !active.has(j.id) && !busy.has(j.workspaceId),
      );
      // Per-video jobs never take every slot: one stays free for a new connection or a main job.
      const lowRunning = [...active.values()].filter(v => v.low).length;
      const lowAllowed = lowRunning < Math.max(1, workspaceConcurrency - 1);
      const job = ready
        .filter(j => lowAllowed || j.priority !== 'low')
        .sort((a, b) => (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1))[0];
      if (!job) return;
      const entry = { workspaceId: job.workspaceId, low: job.priority === 'low', task: null };
      active.set(job.id, entry);
      entry.task = run(job)
        .catch(error => logger.error({ code: 'SYNC_JOB_FAILED', error: error?.message ?? String(error) }))
        .finally(() => {
          active.delete(job.id);
          drain();
        });
    }
  }
  async function schedule() {
    for (const w of snapshot().workspaces.filter(w => w.id === 'studio-live' || w.kind === 'user'))
      await enqueue(w.id, new URLSearchParams(), { reason: 'scheduled' });
  }
  return {
    status,
    enqueue,
    drain,
    async start() {
      stopped = false;
      await repository.update(s => {
        for (const j of s.syncJobs ?? [])
          if (j.status === 'running') {
            j.status = 'queued';
            j.phase = 'Retomando';
          }
      });
      await schedule();
      void drain();
      timer = setInterval(() => {
        void schedule().catch(() => {});
      }, intervalMs);
      timer.unref();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      // Last progress is saved; the running job is re-queued on the next start anyway.
      void flushProgress().catch(() => {});
    },
    async idle() {
      while (active.size || snapshot().syncJobs?.some(j => j.status === 'queued')) {
        await yieldEventLoop();
        if (stopped) return;
      }
    },
  };
}
