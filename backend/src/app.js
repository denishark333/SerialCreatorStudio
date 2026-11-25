import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createLegal } from './legal.js';
import { createPrivacy } from './privacy.js';
import { createMemberships } from './memberships.js';
import { createSynchronizer } from './synchronizer.js';
import { createStudio } from './studio.js';
import { createReports } from './reports.js';
import { ApiError, fail } from './errors.js';
import { createService } from './service.js';
import { createLiveStats } from './livestats.js';
import { openapi } from './openapi.js';
import { clientAddress, createResponder, readJsonBody, safeEqual } from './http/request.js';
import { dispatch } from './http/router.js';
import { publicRoutes } from './routes/public.js';
import { privacyRoutes, workspaceRoutes } from './routes/workspace.js';

const WORKSPACE_PATH = /^\/api\/v1\/workspaces\/([^/]+)\/(.+)$/;

/**
 * HTTP entry point. Request pipeline:
 *   CORS -> public routes -> authentication -> workspace scope -> privacy routes -> workspace routes -> 404
 * Platform sessions are restricted to one workspace. API_TOKEN is a separate administrator credential.
 */
export function createApp({
  repository,
  auth = null,
  token = '',
  origins = ['http://127.0.0.1:5173', 'http://localhost:5173'],
  logger = console,
  youtube = null,
  streams = null,
  legalConfig = {},
  requireConsent = false,
  revoke,
  autoSync = false,
  syncIntervalMs = 1800000,
  syncConcurrency = 4,
  syncWorkspaces = 2,
  syncCadence = {},
  trustProxy = false,
}) {
  const service = createService(repository);
  const legal = createLegal(legalConfig);
  const reports = youtube ? createReports({ repository, youtube }) : null;
  const memberships = youtube ? createMemberships({ repository, youtube }) : null;
  const studio = youtube ? createStudio({ repository, youtube }) : null;
  const synchronizer = youtube
    ? createSynchronizer({
        repository,
        youtube,
        streams,
        studio,
        reports,
        memberships,
        intervalMs: syncIntervalMs,
        concurrency: syncConcurrency,
        workspaceConcurrency: syncWorkspaces,
        ...syncCadence,
      })
    : null;
  const privacy = createPrivacy({ repository, auth, youtube, streams, revoke });

  /** Fire-and-forget work whose failure must be visible in the logs, never to the client. */
  const runInBackground = (task, fn) =>
    void Promise.resolve()
      .then(fn)
      .catch(error =>
        logger.error({ code: 'BACKGROUND_TASK_FAILED', task, error: error?.code ?? error?.message ?? String(error) }),
      );
  const afterConnection = workspaceId => {
    if (autoSync && synchronizer) {
      runInBackground('connection-sync', () =>
        synchronizer.enqueue(workspaceId, new URLSearchParams(), { force: true, reason: 'connection' }),
      );
    }
  };

  const liveStats = createLiveStats({ repository });
  const deps = {
    repository,
    service,
    auth,
    youtube,
    streams,
    studio,
    reports,
    memberships,
    synchronizer,
    privacy,
    liveStats,
  };
  const unauthenticated = publicRoutes({
    legal,
    auth,
    youtube,
    streams,
    requireConsent,
    afterConnection,
    storage: repository.kind ?? 'memory',
  });
  const privacyTable = privacyRoutes(deps);
  const workspaceTable = workspaceRoutes({ ...deps, autoSync, afterConnection, runInBackground });

  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const respond = createResponder(res);
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/$/, '');
    let leaveWorkspace;
    try {
      const origin = req.headers.origin;
      if (origin && !origins.includes(origin)) fail(403, 'ORIGIN_NOT_ALLOWED', 'Origem não permitida.');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return respond.noContent();
      }

      const ctx = {
        req,
        res,
        respond,
        method: req.method,
        path,
        query: url.searchParams,
        clientAddress: clientAddress(req, trustProxy),
        body: () => readJsonBody(req),
      };
      if (await dispatch(unauthenticated, ctx, path)) return;

      // Authentication: a platform session (one workspace) or the owner API_TOKEN (all workspaces).
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const session = auth?.session(bearer) ?? null;
      if (token && !session && !safeEqual(req.headers.authorization ?? '', `Bearer ${token}`)) {
        fail(401, 'UNAUTHORIZED', 'Credencial de acesso ausente ou inválida.');
      }
      if (auth && path === '/api/v1/auth/logout' && req.method === 'POST') {
        await auth.logout(bearer);
        return respond.noContent();
      }
      if (auth && path === '/api/v1/auth/refresh' && req.method === 'POST') {
        if (!session) fail(403, 'PERSONAL_SESSION_REQUIRED', 'Apenas sessões de plataforma são renovadas.');
        return respond.json(200, { data: await auth.refresh(bearer) });
      }
      const meta = { requestId, mode: 'live', dataSource: 'platforms', generatedAt: new Date().toISOString() };
      if (req.method === 'GET' && path === '/api/v1/openapi.json') return respond.json(200, openapi);
      if (req.method === 'GET' && path === '/api/v1/workspaces') {
        const data = service.workspaces().filter(w => !session || w.id === session.workspaceId);
        return respond.json(200, { data, meta });
      }

      const scope = path.match(WORKSPACE_PATH);
      if (!scope) fail(404, 'ROUTE_NOT_FOUND', 'Rota não encontrada.');
      const [, workspaceId, resource] = scope;
      if (session && workspaceId !== session.workspaceId) {
        fail(403, 'WORKSPACE_FORBIDDEN', 'Este estúdio pertence a outro usuário.');
      }
      Object.assign(ctx, { workspaceId, resource, session, meta });
      if (await dispatch(privacyTable, ctx, resource)) return;

      leaveWorkspace = privacy.enter(workspaceId);
      ctx.live =
        workspaceId === 'studio-live' ||
        repository.snapshot().workspaces.some(v => v.id === workspaceId && v.kind === 'user');
      if (await dispatch(workspaceTable, ctx, resource)) return;
      fail(404, 'ROUTE_NOT_FOUND', 'Rota não encontrada.');
    } catch (error) {
      const known = error instanceof ApiError;
      if (!known) {
        // Path only: query strings may carry OAuth codes, tickets or state.
        logger.error({
          requestId,
          code: 'INTERNAL_ERROR',
          method: req.method,
          path,
          message: error?.message,
          stack: error?.stack,
        });
      }
      if (res.headersSent) return void res.end();
      respond.json(known ? error.status : 500, {
        error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : 'Erro interno.',
          ...(known && error.details ? { details: error.details } : {}),
        },
        meta: { requestId },
      });
    } finally {
      leaveWorkspace?.();
    }
  });
  // requestTimeout limits receiving the request (headers + body), not how long a handler may take.
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.synchronizer = synchronizer;
  server.privacy = privacy;
  return server;
}
