import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRepository as createRepository } from './fixtures/repository.js';
import { createSynchronizer } from '../src/synchronizer.js';
const range = new URLSearchParams({ from: '2026-11-01', to: '2026-11-13' });
async function fixture({ failVideo = false, failVideos = [], warnVideos = [], videos = 3, concurrency = 4 } = {}) {
  const repository = await createRepository();
  await repository.update(s => {
    s.workspaces.push({ id: 'studio-live' });
    s.channels.push({ id: 'ch', workspaceId: 'studio-live', name: 'Real', platform: 'YouTube', dataSource: 'youtube' });
    for (let i = 0; i < videos; i++)
      s.contents.push({
        id: 'real-' + i,
        workspaceId: 'studio-live',
        channelId: 'ch',
        dataSource: 'youtube',
        title: 'Video ' + i,
      });
  });
  const calls = [];
  const youtube = {
    sync: async () => {
      calls.push('catalog');
      return { complete: true };
    },
  };
  const studio = {
    classify: async () => calls.push('classify'),
    syncPlaylists: async () => {
      calls.push('playlists');
      return { complete: true };
    },
    morePlaylist: async () => {},
    syncVideo: async (w, id, p) => {
      calls.push(id);
      if ((failVideo && id === 'real-1') || failVideos.includes(id)) throw new Error('Provider failure');
      const report = {
        workspaceId: w,
        contentId: id,
        from: p.get('from'),
        to: p.get('to'),
        fetchedAt: new Date().toISOString(),
        ...Object.fromEntries(
          ['summary', 'daily', 'retention', 'traffic', 'revenue'].map(k => [
            k,
            { status: warnVideos.includes(id) && k === 'retention' ? 'unavailable' : 'available' },
          ]),
        ),
      };
      await repository.update(s => {
        s.videoReports ??= [];
        s.videoReports.push(report);
      });
      return report;
    },
  };
  const reports = {
    sync: async () => {
      calls.push('reports');
      return { sections: { daily: 'available', revenue: 'permission_required' } };
    },
    syncComments: async () => {
      calls.push('comments');
      return { complete: true };
    },
  };
  return {
    repository,
    calls,
    studio,
    worker: createSynchronizer({
      repository,
      youtube,
      studio,
      reports,
      concurrency,
      intervalMs: 3600000,
      progressFlushMs: 60000,
    }),
  };
}
test('one workspace job populates all videos and all source sections automatically', async () => {
  const f = await fixture();
  const first = await f.worker.enqueue('studio-live', range);
  const duplicate = await f.worker.enqueue('studio-live', range);
  assert.equal(first.id, duplicate.id);
  await f.worker.idle();
  const status = f.worker.status('studio-live');
  assert.equal(status.latest.status, 'completed');
  assert.equal(status.latest.completedVideos, 3);
  assert.equal(status.latest.totalVideos, 3);
  for (const name of ['catalog', 'classify', 'playlists', 'reports', 'comments', 'real-0', 'real-1', 'real-2'])
    assert.ok(f.calls.includes(name));
  assert.equal(f.repository.read().videoReports.length, 3);
  const length = f.calls.length;
  await f.worker.enqueue('studio-live', range);
  await f.worker.idle();
  assert.equal(f.calls.length, length);
  assert.equal(status.latest.warnings.length, 1);
});
test('provider errors are partial, never a false successful all-video sync', async () => {
  const f = await fixture({ failVideo: true });
  await f.worker.enqueue('studio-live', range);
  await f.worker.idle();
  const job = f.worker.status('studio-live').latest;
  assert.equal(job.status, 'partial');
  assert.equal(job.completedVideos, 3);
  assert.ok(job.errors.some(e => e.message === 'Provider failure'));
  assert.equal(f.repository.read().videoReports.length, 2);
});
test('a restarted queue resumes work and reuses already cached per-video reports', async () => {
  const f = await fixture();
  await f.worker.enqueue('studio-live', range);
  await f.worker.idle();
  await f.repository.update(s => {
    const job = s.syncJobs.find(j => j.workspaceId === 'studio-live');
    job.status = 'running';
    job.phase = 'interrupted';
  });
  await f.worker.start();
  await f.worker.idle();
  f.worker.stop();
  const jobs = f.repository.read().syncJobs.filter(j => j.workspaceId === 'studio-live');
  assert.ok(jobs.every(j => j.status === 'completed'));
  assert.ok(f.calls.filter(c => c === 'real-0').length <= 2);
});
test('manual global refresh updates all videos again; a new period is independent', async () => {
  const f = await fixture();
  await f.worker.enqueue('studio-live', range);
  await f.worker.idle();
  await f.worker.enqueue('studio-live', range, { force: true, reason: 'manual' });
  await f.worker.idle();
  assert.equal(f.calls.filter(c => c === 'real-0').length, 2);
  assert.equal(f.worker.status('studio-live').latest.completedVideos, 3);
});

test('video tasks overlap, honor concurrency, and progress finishes only after active work drains', async () => {
  const f = await fixture({ concurrency: 2 });
  let release;
  const gate = new Promise(r => {
    release = r;
  });
  let active = 0,
    maximum = 0,
    started = 0;
  const save = f.studio.syncVideo;
  f.studio.syncVideo = async (...args) => {
    started++;
    maximum = Math.max(maximum, ++active);
    await gate;
    try {
      return await save(...args);
    } finally {
      active--;
    }
  };
  await f.worker.enqueue('studio-live', range);
  for (let i = 0; i < 100 && started < 2; i++) await new Promise(setImmediate);
  assert.equal(started, 2);
  assert.equal(active, 2);
  assert.equal(f.worker.status('studio-live').latest.completedVideos, 0);
  release();
  await f.worker.idle();
  assert.equal(maximum, 2);
  assert.equal(started, 3);
  assert.equal(active, 0);
  assert.equal(f.worker.status('studio-live').latest.completedVideos, 3);
});

test('several errors and per-video warnings end as partial, not as a worker crash on frozen state', async () => {
  const f = await fixture({ failVideos: ['real-0', 'real-2'], warnVideos: ['real-1'], concurrency: 1 });
  await f.worker.enqueue('studio-live', range);
  await f.worker.idle();
  const job = f.worker.status('studio-live').latest;
  assert.equal(job.status, 'partial');
  assert.equal(job.errors.filter(e => e.message === 'Provider failure').length, 2);
  assert.ok(!job.errors.some(e => e.code === 'WORKER_ERROR'), JSON.stringify(job.errors));
  assert.ok(job.warnings.some(w => w.contentId === 'real-1' && w.section === 'retention'));
  const saved = f.repository.read().syncJobs.find(j => j.id === job.id);
  assert.equal(saved.completedVideos, 3);
  assert.equal(saved.warnings.length, job.warnings.length);
});

test('progress is shown live but not written to storage once per video', async () => {
  const f = await fixture({ videos: 40 });
  let writes = 0;
  const update = f.repository.update;
  f.repository.update = fn => {
    writes++;
    return update(fn);
  };
  let release;
  const gate = new Promise(r => {
    release = r;
  });
  const save = f.studio.syncVideo;
  f.studio.syncVideo = async (w, id, p) => {
    if (id === 'real-39') await gate;
    return save(w, id, p);
  };
  await f.worker.enqueue('studio-live', range);
  for (let i = 0; i < 500 && f.worker.status('studio-live').latest.completedVideos < 39; i++)
    await new Promise(setImmediate);
  assert.equal(f.worker.status('studio-live').latest.completedVideos, 39, 'status shows unsaved progress');
  release();
  await f.worker.idle();
  // 40 writes are the fixture's own report saves; the synchronizer adds only a handful (claim, totals, result).
  assert.ok(writes < 40 + 15, `${writes} repository writes`);
  const saved = f.repository.read().syncJobs.find(j => j.workspaceId === 'studio-live' && j.kind === 'videos');
  assert.equal(saved.status, 'completed');
  assert.equal(saved.completedVideos, 40);
});

/** Several studios with one channel each; the catalog step waits on a gate so overlap can be observed. */
async function studios(names, { workspaceConcurrency = 2 } = {}) {
  const repository = await createRepository();
  await repository.update(s => {
    for (const w of names) {
      s.workspaces.push({ id: w, kind: 'user' });
      s.channels.push({ id: 'ch-' + w, workspaceId: w, name: w, platform: 'YouTube', dataSource: 'youtube' });
    }
  });
  const running = new Map(),
    seen = [],
    analytics = [];
  let maximum = 0,
    release;
  const gate = new Promise(r => {
    release = r;
  });
  const youtube = {
    sync: async w => {
      running.set(w, (running.get(w) ?? 0) + 1);
      seen.push(w);
      maximum = Math.max(
        maximum,
        [...running.values()].reduce((a, b) => a + b, 0),
      );
      assert.ok(running.get(w) <= 1, 'two jobs of the same studio ran at once');
      await gate;
      running.set(w, running.get(w) - 1);
      return { complete: true };
    },
  };
  const idle = async () => ({ complete: true });
  const worker = createSynchronizer({
    repository,
    youtube,
    studio: { classify: idle, syncPlaylists: idle, morePlaylist: idle, syncVideo: idle },
    reports: {
      sync: async (w, id, p) => {
        analytics.push(w + ' ' + p.get('from'));
        return { sections: {} };
      },
      syncComments: idle,
    },
    intervalMs: 3600000,
    workspaceConcurrency,
  });
  const settle = async () => {
    for (let i = 0; i < 100; i++) await new Promise(setImmediate);
  };
  return { repository, worker, seen, analytics, release, settle, maximum: () => maximum };
}

test('different studios synchronize at the same time, up to the workspace limit', async () => {
  const f = await studios(['studio-a', 'studio-b', 'studio-c']);
  for (const w of ['studio-a', 'studio-b', 'studio-c']) await f.worker.enqueue(w, range);
  await f.settle();
  assert.deepEqual(f.seen.sort(), ['studio-a', 'studio-b'], 'the first two start together; the third waits');
  f.release();
  await f.worker.idle();
  assert.equal(f.maximum(), 2);
  assert.ok(f.seen.includes('studio-c'));
  for (const w of ['studio-a', 'studio-b', 'studio-c']) assert.equal(f.worker.status(w).latest.status, 'completed', w);
});

test('a studio never runs two jobs at once, even with free slots', async () => {
  const f = await studios(['studio-a'], { workspaceConcurrency: 4 });
  await f.worker.enqueue('studio-a', range);
  await f.worker.enqueue('studio-a', new URLSearchParams({ from: '2026-10-01', to: '2026-10-31' }));
  await f.settle();
  assert.equal(f.seen.length, 1);
  assert.equal(f.analytics.length, 0, 'the second job waits for the first');
  f.release();
  await f.worker.idle();
  // The second period only needs its analytics: the catalog was collected minutes ago.
  assert.equal(f.seen.length, 1);
  assert.deepEqual(f.analytics, ['studio-a 2026-11-01', 'studio-a 2026-10-01']);
  assert.ok(f.worker.status('studio-a').queued.length === 0);
});

test('a queued job of a merged studio is cancelled instead of blocking the queue', async () => {
  const f = await studios(['studio-a', 'studio-b'], { workspaceConcurrency: 1 });
  f.release();
  await f.worker.enqueue('studio-a', range);
  await f.repository.update(s => {
    s.workspaces.find(w => w.id === 'studio-b').mergedInto = 'studio-a';
    s.syncJobs.push({
      id: 'orphan',
      workspaceId: 'studio-b',
      ...Object.fromEntries(range),
      status: 'queued',
      createdAt: new Date().toISOString(),
      errors: [],
      warnings: [],
    });
  });
  f.worker.drain();
  await f.worker.idle();
  assert.equal(f.repository.read().syncJobs.find(j => j.id === 'orphan').status, 'cancelled');
});

test('a new connection or manual sync goes ahead of automatic jobs already waiting', async () => {
  const f = await studios(['studio-a', 'studio-b', 'studio-c'], { workspaceConcurrency: 1 });
  await f.worker.enqueue('studio-a', range, { reason: 'scheduled' });
  await f.settle();
  await f.worker.enqueue('studio-b', range, { reason: 'scheduled' });
  await f.worker.enqueue('studio-c', range, { reason: 'connection' });
  f.release();
  await f.worker.idle();
  assert.deepEqual(f.seen, ['studio-a', 'studio-c', 'studio-b']);
});

test('a manual sync promotes the automatic job already queued for the studio instead of duplicating it', async () => {
  const f = await studios(['studio-a', 'studio-b'], { workspaceConcurrency: 1 });
  await f.worker.enqueue('studio-a', range, { reason: 'scheduled' });
  await f.settle();
  const queued = await f.worker.enqueue('studio-b', range, { reason: 'scheduled' });
  const manual = await f.worker.enqueue('studio-b', range, { reason: 'manual' });
  assert.equal(manual.id, queued.id);
  assert.equal(manual.priority, 'high');
  assert.equal(manual.reason, 'manual');
  assert.equal(f.repository.read().syncJobs.filter(j => j.workspaceId === 'studio-b').length, 1);
  f.release();
  await f.worker.idle();
});

/** Studios with their own videos; per-video reports wait on a gate (the long part of a sync). */
async function studiosWithVideos(videosPerStudio, { workspaceConcurrency = 2 } = {}) {
  const repository = await createRepository();
  await repository.update(s => {
    for (const [w, videos] of Object.entries(videosPerStudio)) {
      s.workspaces.push({ id: w, kind: 'user' });
      s.channels.push({ id: 'ch-' + w, workspaceId: w, name: w, platform: 'YouTube', dataSource: 'youtube' });
      for (let i = 0; i < videos; i++)
        s.contents.push({ id: w + '-v' + i, workspaceId: w, channelId: 'ch-' + w, dataSource: 'youtube', title: 'v' });
    }
  });
  const mainDone = [],
    videoStarted = [];
  let release;
  const gate = new Promise(r => {
    release = r;
  });
  const ok = async () => ({ complete: true });
  const worker = createSynchronizer({
    repository,
    youtube: { sync: ok },
    studio: {
      classify: ok,
      syncPlaylists: ok,
      morePlaylist: ok,
      syncVideo: async w => {
        if (!videoStarted.includes(w)) videoStarted.push(w);
        await gate;
        return Object.fromEntries(
          ['summary', 'daily', 'retention', 'traffic', 'revenue'].map(k => [k, { status: 'available' }]),
        );
      },
    },
    reports: {
      sync: async w => {
        mainDone.push(w);
        return { sections: {} };
      },
      syncComments: ok,
    },
    intervalMs: 3600000,
    workspaceConcurrency,
  });
  const settle = async () => {
    for (let i = 0; i < 200; i++) await new Promise(setImmediate);
  };
  return { repository, worker, mainDone, videoStarted, release, settle };
}

test('the main data is ready before the per-video reports, which run as a separate low-priority job', async () => {
  const f = await studiosWithVideos({ 'studio-a': 3 });
  await f.worker.enqueue('studio-a', range, { reason: 'connection' });
  await f.settle();
  const status = f.worker.status('studio-a');
  const main = f.repository.read().syncJobs.find(j => !j.kind);
  assert.equal(main.status, 'completed', 'main job finished while the video reports are still running');
  assert.equal(status.running?.kind, 'videos');
  assert.equal(status.running.priority, 'low');
  assert.equal(status.running.totalVideos, 3);
  f.release();
  await f.worker.idle();
  const done = f.worker.status('studio-a').latest;
  assert.equal(done.kind, 'videos');
  assert.equal(done.status, 'completed');
  assert.equal(done.completedVideos, 3);
});

test("a new connection does not wait for another studio's per-video reports", async () => {
  const f = await studiosWithVideos({ 'studio-a': 5, 'studio-b': 5, 'studio-new': 0 });
  await f.worker.enqueue('studio-a', range, { reason: 'connection' });
  await f.worker.enqueue('studio-b', range, { reason: 'connection' });
  await f.settle();
  assert.deepEqual(f.mainDone.sort(), ['studio-a', 'studio-b']);
  assert.equal(f.videoStarted.length, 1, 'per-video jobs leave one slot free (2 slots, at most 1 low)');
  await f.worker.enqueue('studio-new', range, { reason: 'connection' });
  await f.settle();
  assert.ok(f.mainDone.includes('studio-new'), 'the new studio ran while video reports were still blocked');
  assert.equal(f.worker.status('studio-new').latest.status, 'completed');
  f.release();
  await f.worker.idle();
  assert.deepEqual(f.videoStarted.sort(), ['studio-a', 'studio-b']);
});

/** One YouTube channel + one Twitch channel, a controllable clock, and a log of what each sync collected. */
async function cadence() {
  const repository = await createRepository();
  await repository.update(s => {
    s.workspaces.push({ id: 'studio-a', kind: 'user' });
    s.channels.push(
      { id: 'yt', workspaceId: 'studio-a', name: 'YT', platform: 'YouTube', dataSource: 'youtube' },
      { id: 'tw', workspaceId: 'studio-a', name: 'TW', platform: 'Twitch', dataSource: 'twitch' },
    );
    s.contents.push({ id: 'v1', workspaceId: 'studio-a', channelId: 'yt', dataSource: 'youtube', title: 'v1' });
  });
  let clock = Date.parse('2026-11-18T12:00:00Z');
  const log = [];
  const record =
    name =>
    async (...args) => {
      log.push(name + (args[2]?.mode ? ':' + args[2].mode : ''));
      return { complete: true, sections: {} };
    };
  const worker = createSynchronizer({
    repository,
    youtube: { sync: record('catalog') },
    streams: { sync: record('twitch') },
    studio: {
      classify: record('formats'),
      syncPlaylists: record('playlists'),
      morePlaylist: record('more'),
      syncVideo: async (w, id, p) => {
        log.push('video');
        const report = { workspaceId: w, contentId: id, from: p.get('from'), to: p.get('to') };
        await repository.update(s => {
          s.videoReports = [
            ...(s.videoReports ?? []).filter(r => r.contentId !== id),
            { ...report, fetchedAt: new Date(clock).toISOString() },
          ];
        });
        return Object.fromEntries(
          ['summary', 'daily', 'retention', 'traffic', 'revenue'].map(k => [k, { status: 'available' }]),
        );
      },
    },
    reports: { sync: record('analytics'), syncComments: record('comments') },
    now: () => clock,
  });
  const run = async (reason = 'scheduled', force = false) => {
    log.length = 0;
    await worker.enqueue('studio-a', range, { reason, force });
    await worker.idle();
    return [...log].sort();
  };
  return { worker, run, advance: hours => (clock += hours * 3600000), repository };
}

test('automatic syncs collect each kind of data at its own cadence; lives on every tick', async () => {
  const f = await cadence();
  assert.deepEqual(await f.run('scheduled'), [
    'analytics',
    'catalog',
    'comments',
    'formats',
    'playlists',
    'twitch',
    'video',
  ]);
  f.advance(1);
  assert.deepEqual(await f.run('scheduled'), ['twitch'], '1 h later: only Twitch/Kick');
  f.advance(6);
  assert.deepEqual(
    await f.run('scheduled'),
    ['catalog', 'comments:incremental', 'playlists', 'twitch'],
    '7 h: catalog and new comments, no analytics',
  );
  f.advance(18);
  assert.deepEqual(
    await f.run('scheduled'),
    ['analytics', 'catalog', 'comments', 'formats', 'playlists', 'twitch', 'video'],
    '25 h: analytics, per-video reports and the daily full comment pass',
  );
});

test('a manual sync collects everything again, then rests for 15 minutes', async () => {
  const f = await cadence();
  await f.run('scheduled');
  f.advance(0.6);
  const manual = await f.run('manual', true);
  assert.ok(
    ['analytics', 'catalog', 'video'].every(v => manual.includes(v)),
    manual.join(),
  );
  f.advance(0.1);
  await assert.rejects(f.worker.enqueue('studio-a', range, { reason: 'manual', force: true }), error => {
    assert.equal(error.code, 'SYNC_COOLDOWN');
    assert.equal(error.status, 429);
    assert.match(error.message, /9 min/);
    assert.ok(error.details.retryAt);
    return true;
  });
  // Opening a screen (not forced) is never refused.
  await f.worker.enqueue('studio-a', range, { reason: 'view' });
  f.advance(0.2);
  assert.ok((await f.run('manual', true)).includes('catalog'), 'after 15 min it runs again');
});
