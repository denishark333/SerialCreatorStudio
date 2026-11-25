import { fail } from '../errors.js';
import { paginate } from '../http/request.js';
import { middleware, route } from '../http/router.js';

const ID = '([^/]+)';
const PLATFORMS = ['YouTube', 'Twitch', 'Kick'];

/**
 * Per-resource rest for direct provider calls (each one spends the YouTube quota shared by every user).
 * The screens use the global queue; these endpoints stay for tools and the API contract.
 */
export function createThrottle(now = () => Date.now()) {
  const last = new Map();
  return (key, ms) => {
    const at = last.get(key);
    if (at !== undefined && now() - at < ms) {
      const minutes = Math.max(1, Math.ceil((at + ms - now()) / 60000));
      fail(429, 'SYNC_COOLDOWN', `Coleta feita há pouco. Tente de novo em ${minutes} min.`, {
        retryAt: new Date(at + ms).toISOString(),
      });
    }
    last.set(key, now());
    if (last.size > 5000) for (const [k, v] of last) if (now() - v > 3600000) last.delete(k);
  };
}
const DIRECT_SYNC_MS = 15 * 60000;

/**
 * Privacy routes run before the workspace is marked as "in use", because erasing
 * a studio must not count itself as a concurrent reader.
 * Note: DELETE connections/:id is intentionally handled here (erase + token revocation).
 */
export function privacyRoutes({ privacy }) {
  const erase = async ({ respond, workspaceId, meta }, connectionId = null) =>
    respond.json(200, { data: await privacy.erase(workspaceId, connectionId), meta });
  return [
    route('GET', 'privacy', ({ respond, workspaceId, meta }) =>
      respond.json(200, { data: privacy.preview(workspaceId), meta }),
    ),
    route('DELETE', 'privacy', async ctx => {
      if (!ctx.session) fail(403, 'PERSONAL_SESSION_REQUIRED', 'Entre com uma conta pessoal para excluir o estúdio.');
      const value = await ctx.body();
      if (value.confirmation !== 'EXCLUIR') fail(400, 'CONFIRMATION_REQUIRED', 'Digite EXCLUIR para confirmar.');
      await erase(ctx);
    }),
    route('DELETE', new RegExp(`^privacy/connections/${ID}$`), erase),
    route('DELETE', new RegExp(`^connections/${ID}$`), erase),
  ];
}

/** Workspace-scoped routes, in precedence order. */
export function workspaceRoutes(deps) {
  deps = { throttle: createThrottle(), ...deps };
  return [
    ...accountRoutes(deps),
    ...syncRoutes(deps),
    ...connectionRoutes(deps),
    ...(deps.studio ? studioRoutes(deps) : []),
    ...(deps.liveStats ? liveStatsRoutes(deps) : []),
    ...reportRoutes(deps),
    ...legacyRoutes(deps),
  ];
}

function accountRoutes({ repository, auth, afterConnection }) {
  return [
    route(
      'POST',
      'connections/merge',
      async ({ respond, body, workspaceId, meta }) => {
        const value = await body();
        if (typeof value.confirm !== 'boolean') {
          fail(400, 'INVALID_CONFIRMATION', 'Confirme ou cancele a união dos estúdios.');
        }
        const result = await auth.merge(workspaceId, value.id, value.secret, value.confirm);
        if (result.status === 'connected') afterConnection(workspaceId);
        respond.json(200, { data: result, meta });
      },
      { when: () => Boolean(auth) },
    ),
    route('GET', 'preferences', ({ respond, workspaceId, meta }) => {
      const workspace = repository.snapshot().workspaces.find(v => v.id === workspaceId);
      if (!workspace) fail(404, 'WORKSPACE_NOT_FOUND', 'Estúdio não encontrado.');
      respond.json(200, { data: { platform: workspace.preferences?.platform ?? null }, meta });
    }),
    route('PATCH', 'preferences', async ({ respond, body, workspaceId, meta }) => {
      const value = await body();
      if (Object.keys(value).some(key => key !== 'platform') || !PLATFORMS.includes(value.platform)) {
        fail(400, 'INVALID_PLATFORM', 'Selecione YouTube, Twitch ou Kick.');
      }
      const preferences = await repository.update(s => {
        const workspace = s.workspaces.find(v => v.id === workspaceId);
        if (!workspace) fail(404, 'WORKSPACE_NOT_FOUND', 'Estúdio não encontrado.');
        workspace.preferences = { ...workspace.preferences, platform: value.platform };
        return workspace.preferences;
      });
      respond.json(200, { data: preferences, meta });
    }),
  ];
}

function syncRoutes({ repository, synchronizer, autoSync, runInBackground }) {
  if (!synchronizer) return [];
  const live = ctx => ctx.live;
  return [
    route(
      'GET',
      'sync/status',
      ({ respond, workspaceId, meta }) => respond.json(200, { data: synchronizer.status(workspaceId), meta }),
      { when: live },
    ),
    route(
      'POST',
      'sync',
      async ({ respond, query, workspaceId, meta }) => {
        // Only the "Sincronizar" button (force=true) is a manual sync; opening the screen or changing the
        // period sends force=false and follows the automatic cadence.
        const force = query.get('force') === 'true';
        const job = await synchronizer.enqueue(workspaceId, query, { force, reason: force ? 'manual' : 'view' });
        respond.json(202, { data: job, meta });
      },
      { when: live },
    ),
    // Opening any screen refreshes stale data in the background (respecting the sync interval).
    middleware(({ method, live: isLive, resource, query, workspaceId }) => {
      if (!autoSync || !isLive || method !== 'GET' || resource.startsWith('sync/')) return;
      if (!repository.snapshot().channels.some(c => c.workspaceId === workspaceId)) return;
      runInBackground('view-sync', () => synchronizer.enqueue(workspaceId, query, { reason: 'view' }));
    }),
  ];
}

function connectionRoutes({ service, auth, youtube, streams }) {
  if (!youtube) return [];
  return [
    route('GET', 'connections', ({ respond, query, workspaceId, live, meta }) => {
      if (!live) service.channels(workspaceId, query);
      const google = youtube.status(workspaceId);
      const other = streams?.status(workspaceId);
      respond.json(200, {
        data: {
          ...google,
          items: [...google.items.filter(c => c.platform === 'YouTube'), ...(other?.items ?? [])],
          providers: [
            { platform: 'YouTube', configured: google.configured, redirectUri: google.redirectUri },
            ...(other?.providers ?? []),
          ],
        },
        meta,
      });
    }),
    route('POST', 'connections/YouTube/authorize', ({ clientAddress, respond, workspaceId, meta }) => {
      const flow = auth?.begin('YouTube', clientAddress, 'connection', workspaceId);
      respond.json(200, { data: { ...(flow ?? {}), ...youtube.authorize(workspaceId, null, flow?.id) }, meta });
    }),
    route(
      'POST',
      /^connections\/(Twitch|Kick)\/authorize$/,
      ({ clientAddress, respond, workspaceId, meta }, platform) => {
        const flow = auth?.begin(platform, clientAddress, 'connection', workspaceId);
        respond.json(200, {
          data: { ...(flow ?? {}), ...streams.authorize(workspaceId, platform, null, flow?.id) },
          meta,
        });
      },
      { when: () => Boolean(streams) },
    ),
  ];
}

/** YouTube Studio features, only for real (live) studios. */
function studioRoutes({ studio, memberships, throttle }) {
  const opts = { when: ctx => ctx.live };
  const data =
    (status, fn) =>
    async (ctx, ...params) =>
      ctx.respond.json(status, { data: await fn(ctx, ...params), meta: ctx.meta });
  const list =
    fn =>
    async (ctx, ...params) =>
      ctx.respond.json(200, { ...paginate(await fn(ctx, ...params), ctx.query), meta: ctx.meta });
  const r = (method, pattern, handler) => route(method, pattern, handler, opts);
  return [
    r(
      'GET',
      'catalog-summary',
      data(200, ({ workspaceId: w, query }) => studio.summary(w, query)),
    ),
    r(
      'GET',
      'catalog',
      list(({ workspaceId: w, query }) => studio.catalog(w, query)),
    ),
    r(
      'GET',
      'playlists',
      list(({ workspaceId: w, query }) => studio.playlists(w, query)),
    ),
    r(
      'GET',
      'community/members',
      data(200, ({ workspaceId: w, query }) => memberships.list(w, query)),
    ),
    r(
      'GET',
      'community/comments',
      list(({ workspaceId: w, query }) => studio.comments(w, query)),
    ),
    r(
      'GET',
      'subscriber-goal',
      data(200, ({ workspaceId: w, query }) => studio.goal(w, query)),
    ),
    r(
      'PATCH',
      'subscriber-goal',
      data(200, async ({ workspaceId: w, body }) => studio.setGoal(w, await body())),
    ),
    r(
      'GET',
      new RegExp(`^contents/${ID}/details$`),
      data(200, ({ workspaceId: w, query }, id) => studio.details(w, id, query)),
    ),
    r(
      'POST',
      new RegExp(`^contents/${ID}/reports/sync$`),
      data(200, ({ workspaceId: w, query }, id) => {
        throttle(`${w}|video|${id}`, DIRECT_SYNC_MS);
        return studio.syncVideo(w, id, query);
      }),
    ),
    r(
      'POST',
      new RegExp(`^channels/${ID}/formats/sync$`),
      data(200, ({ workspaceId: w, query }, id) => {
        throttle(`${w}|formats|${id}`, DIRECT_SYNC_MS);
        return studio.classify(w, id, query);
      }),
    ),
    r(
      'POST',
      new RegExp(`^channels/${ID}/playlists/sync$`),
      data(200, ({ workspaceId: w }, id) => {
        throttle(`${w}|playlists|${id}`, DIRECT_SYNC_MS);
        return studio.syncPlaylists(w, id);
      }),
    ),
    r(
      'POST',
      new RegExp(`^playlists/${ID}/more$`),
      data(200, ({ workspaceId: w }, id) => {
        throttle(`${w}|more|${id}`, 2000); // "Carregar mais" button: one page at a time
        return studio.morePlaylist(w, id);
      }),
    ),
    r(
      'PATCH',
      new RegExp(`^contents/${ID}/format$`),
      data(200, async ({ workspaceId: w, body }, id) => studio.setFormat(w, id, await body())),
    ),
    r(
      'POST',
      new RegExp(`^community/comments/${ID}/moderation$`),
      data(200, async ({ workspaceId: w, body }, id) => studio.moderate(w, id, await body())),
    ),
    // Heart/pin have no endpoint in the official YouTube Data API; the UI deep-links to the comment instead.
    r('PATCH', new RegExp(`^community/comments/${ID}/annotations$`), () =>
      fail(
        410,
        'LOCAL_ACTION_REMOVED',
        'Local comment actions were removed. Use moderation or the native YouTube action.',
      ),
    ),
    r(
      'POST',
      new RegExp(`^community/comments/${ID}/publish-reply$`),
      data(201, async ({ workspaceId: w, body }, id) => studio.reply(w, id, await body())),
    ),
    r(
      'GET',
      /^financial\/(payouts|deals)$/,
      list(({ workspaceId: w, query }, kind) => studio.financial(w, query, kind === 'payouts' ? 'payout' : 'deal')),
    ),
    r(
      'POST',
      'financial',
      data(201, async ({ workspaceId: w, body }) => studio.saveFinancial(w, await body())),
    ),
    r(
      'PATCH',
      new RegExp(`^financial/${ID}$`),
      data(200, async ({ workspaceId: w, body }, id) => studio.updateFinancial(w, id, await body())),
    ),
    r('DELETE', new RegExp(`^financial/${ID}$`), async ({ workspaceId: w, respond }, id) => {
      await studio.deleteFinancial(w, id);
      respond.noContent();
    }),
  ];
}

/** Twitch/Kick live statistics: broadcasts of the period and the Twitch revenue estimate. */
function liveStatsRoutes({ liveStats }) {
  return [
    route('GET', 'streams/sessions', ({ respond, workspaceId, query, meta }) =>
      respond.json(200, { data: liveStats.sessions(workspaceId, query), meta }),
    ),
    route('GET', 'streams/analytics', ({ respond, workspaceId, query, meta }) =>
      respond.json(200, { data: liveStats.analytics(workspaceId, query), meta }),
    ),
    route('GET', 'streams/revenue', ({ respond, workspaceId, query, meta }) =>
      respond.json(200, { data: liveStats.revenue(workspaceId, query), meta }),
    ),
    route('PATCH', new RegExp(`^channels/${ID}/revenue-settings$`), async ({ respond, workspaceId, body, meta }, id) =>
      respond.json(200, { data: await liveStats.setRevenueSettings(workspaceId, id, await body()), meta }),
    ),
  ];
}

/** Per-channel collection endpoints and live YouTube reports. */
function reportRoutes({ youtube, reports, throttle }) {
  const routes = [];
  if (youtube) {
    routes.push(
      route('POST', new RegExp(`^channels/${ID}/sync$`), async ({ respond, workspaceId, meta }, id) => {
        throttle(`${workspaceId}|catalog|${id}`, DIRECT_SYNC_MS);
        respond.json(200, { data: await youtube.sync(workspaceId, id), meta });
      }),
    );
  }
  if (reports) {
    routes.push(
      route('POST', new RegExp(`^channels/${ID}/reports/sync$`), async ({ respond, workspaceId, query, meta }, id) => {
        throttle(`${workspaceId}|reports|${id}`, DIRECT_SYNC_MS);
        respond.json(200, { data: await reports.sync(workspaceId, id, query), meta });
      }),
      route('POST', new RegExp(`^channels/${ID}/comments/sync$`), async ({ respond, workspaceId, meta }, id) => {
        throttle(`${workspaceId}|comments|${id}`, DIRECT_SYNC_MS);
        respond.json(200, { data: await reports.syncComments(workspaceId, id, { mode: 'incremental' }), meta });
      }),
      route(
        'GET',
        /^(overview|analytics|revenue)$/,
        ({ respond, workspaceId, query, meta }, name) =>
          respond.json(200, { data: reports[name](workspaceId, query), meta }),
        { when: ctx => ctx.live },
      ),
    );
  }
  return routes;
}

/**
 * Generic workspace contract (service.js). Used by planning in every studio and by
 * non-live workspaces (merged studios, test fixtures).
 */
function legacyRoutes({ service }) {
  const LISTS = { channels: 'channels', contents: 'contents', plans: 'plans', 'community/comments': 'comments' };
  const SINGLES = { overview: 'overview', analytics: 'analytics', connections: 'connections', revenue: 'revenue' };
  return [
    route('GET', /^(channels|contents|plans|community\/comments)$/, ({ respond, workspaceId, query, meta }, name) =>
      respond.json(200, { ...paginate(service[LISTS[name]](workspaceId, query), query), meta }),
    ),
    route('GET', /^(overview|analytics|connections|revenue)$/, ({ respond, workspaceId, query, meta }, name) =>
      respond.json(200, { data: service[SINGLES[name]](workspaceId, query), meta }),
    ),
    route('GET', new RegExp(`^contents/${ID}$`), ({ respond, workspaceId, query, meta }, id) =>
      respond.json(200, { data: service.content(workspaceId, id, query), meta }),
    ),
    route(
      ['POST', 'PATCH'],
      /community\/comments/,
      () => fail(409, 'READ_ONLY_YOUTUBE', 'YouTube comments are read-only in this version.'),
      { when: ctx => ctx.live },
    ),
    route('GET', 'plans/records', ({ respond, workspaceId, query, meta }) =>
      respond.json(200, { data: service.planRecords(workspaceId, query), meta }),
    ),
    route('POST', 'plans', async ({ respond, workspaceId, body, meta }) =>
      respond.json(201, { data: await service.createPlan(workspaceId, await body()), meta }),
    ),
    route('PATCH', new RegExp(`^plans/${ID}$`), async ({ respond, workspaceId, body, meta }, id) =>
      respond.json(200, { data: await service.updatePlan(workspaceId, id, await body()), meta }),
    ),
    route('DELETE', new RegExp(`^plans/${ID}$`), async ({ respond, workspaceId }, id) => {
      await service.deletePlan(workspaceId, id);
      respond.noContent();
    }),
    route('PATCH', new RegExp(`^community/comments/${ID}$`), async ({ respond, workspaceId, body, meta }, id) =>
      respond.json(200, { data: await service.updateComment(workspaceId, id, await body()), meta }),
    ),
    route('POST', new RegExp(`^community/comments/${ID}/replies$`), async ({ respond, workspaceId, body, meta }, id) =>
      respond.json(201, { data: await service.reply(workspaceId, id, await body()), meta }),
    ),
    route(
      'POST',
      /^(connections\/(YouTube|Twitch|Kick)\/authorize|channels\/[^/]+\/sync)$/,
      ({ workspaceId, query }) => {
        service.channels(workspaceId, query);
        fail(501, 'CONNECTOR_NOT_IMPLEMENTED', 'OAuth e sincronização oficial ainda não implementados.');
      },
    ),
  ];
}
