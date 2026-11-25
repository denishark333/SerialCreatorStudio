import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { fail } from './errors.js';
const random = () => randomBytes(32).toString('base64url');
const SESSION_MS = 12 * 3600000;
/** A session is renewed while in use (see refresh), but never beyond this since the sign-in. */
const SESSION_MAX_MS = 7 * 24 * 3600000;
const hash = v => createHash('sha256').update(v).digest('hex');
const normalizeInvite = value => (typeof value === 'string' ? value.trim().toLowerCase() : '');
/**
 * Verified platform identity -> private workspace. No first-user claim of the legacy studio.
 * `inviteCodes` (INVITE_CODES): when set, creating a new studio requires one of the codes; people who already
 * have a studio sign in without it. Empty = open sign-up.
 */
export function createAuth({ repository, now = () => Date.now(), logger = console, inviteCodes = [] }) {
  const invites = new Set(inviteCodes.map(normalizeInvite).filter(Boolean));
  const pending = new Map(),
    limits = new Map(),
    revocations = new Map();
  // Sessions survive restarts: only the SHA-256 of each access token is persisted (state.authSessions).
  const sessions = new Map(
    (repository.snapshot?.().authSessions ?? [])
      .filter(v => v.expires > now())
      .map(v => [
        v.id,
        {
          workspaceId: v.workspaceId,
          primaryChannelId: v.primaryChannelId,
          expires: v.expires,
          startedAt: v.startedAt ?? v.expires - SESSION_MS,
        },
      ]),
  );
  let saveQueued = null;
  /** Writes the current session map; concurrent calls coalesce into one write. */
  function saveSessions() {
    saveQueued ??= repository
      .update(s => {
        saveQueued = null;
        s.authSessions = [...sessions].map(([id, v]) => ({ id, ...v }));
      })
      .catch(error => {
        saveQueued = null;
        logger.error({ code: 'SESSION_PERSIST_FAILED', error: error?.message });
      });
    return saveQueued;
  }
  function dropSessions(predicate) {
    let changed = false;
    for (const [key, value] of sessions)
      if (predicate(value)) {
        sessions.delete(key);
        changed = true;
      }
    if (changed) void saveSessions();
  }
  function prune() {
    for (const map of [pending, limits, revocations]) for (const [k, v] of map) if (v.expires <= now()) map.delete(k);
    dropSessions(v => v.expires <= now());
  }
  function challenge(id) {
    prune();
    const c = pending.get(id);
    if (!c || c.status !== 'pending') fail(400, 'LOGIN_EXPIRED', 'Login expirado. Inicie novamente.');
    return c;
  }
  return {
    inviteRequired: invites.size > 0,
    begin(provider, address, kind = 'login', targetWorkspaceId = null, consent = null, invite = null) {
      prune();
      const key = address ?? 'unknown',
        l = limits.get(key) ?? { count: 0, expires: now() + 60000 };
      if (++l.count > 10 || pending.size >= 200) fail(429, 'LOGIN_LIMIT', 'Aguarde antes de tentar novamente.');
      limits.set(key, l);
      const id = random(),
        secret = random();
      pending.set(id, {
        provider,
        kind,
        targetWorkspaceId,
        secret: hash(secret),
        consent,
        invite: normalizeInvite(invite),
        createdAt: now(),
        status: 'pending',
        expires: now() + 600000,
      });
      return { id, secret };
    },
    /** `error` (an ApiError) is shown to the person polling the login instead of a generic refusal. */
    reject(id, error = null) {
      const c = pending.get(id);
      if (!c) return;
      c.status = 'denied';
      if (error?.code && error?.status < 500) c.error = { code: error.code, message: error.message };
    },
    async identify(loginId, workspaceId, provider, ids, completionId = null) {
      if (!ids.length) fail(403, 'NO_IDENTITY', 'Nenhum canal foi identificado.');
      const c = loginId ? challenge(loginId) : null;
      if (c) c.primaryExternalId = ids[0];
      if (c && c.provider !== provider) fail(403, 'INVALID_IDENTITY', 'Plataforma incorreta.');
      try {
        return await repository.update(s => {
          s.identities ??= [];
          const flow = loginId ? pending.get(loginId) : completionId ? pending.get(completionId) : null;
          if (flow && flow.status !== 'pending') fail(400, 'LOGIN_EXPIRED', 'Inicie novamente o login.');
          for (const externalId of ids) {
            const blocked = revocations.get(hash(provider + '/' + externalId));
            if (flow && blocked && flow.createdAt <= blocked.cutoff)
              fail(400, 'LOGIN_EXPIRED', 'A tentativa antecede uma exclusão de dados. Entre novamente.');
          }
          const identified = w => {
            if (c) {
              c.workspaceId = w;
              if (c.consent) {
                s.legalConsents ??= [];
                s.legalConsents.push({ workspaceId: w, ...c.consent, acceptedAt: new Date(now()).toISOString() });
              }
            }
            return w;
          };
          const identity = s.identities.find(i => i.provider === provider && ids.includes(i.externalId));
          if (loginId) {
            if (identity) return identified(identity.workspaceId);
            if (invites.size && !invites.has(flow?.invite ?? ''))
              fail(
                403,
                'INVITE_REQUIRED',
                'O Creator Studio está em testes fechados. Informe um código de convite válido para criar seu estúdio.',
              );
            const w = 'studio-' + randomUUID();
            s.workspaces.push({ id: w, name: 'Meu estúdio', timezone: 'America/Sao_Paulo', kind: 'user' });
            s.identities.push({ provider, externalId: ids[0], workspaceId: w });
            return identified(w);
          }
          if (identity && identity.workspaceId !== workspaceId) {
            const flow = completionId ? challenge(completionId) : null;
            if (
              !flow ||
              flow.kind !== 'connection' ||
              flow.provider !== provider ||
              flow.targetWorkspaceId !== workspaceId
            )
              fail(409, 'ACCOUNT_ALREADY_LINKED', 'Autorize a conta a partir de Conexões para unir seus estúdios.');
            if (
              ![workspaceId, identity.workspaceId].every(id =>
                s.workspaces.some(w => w.id === id && w.kind === 'user' && !w.mergedInto),
              )
            )
              fail(409, 'INVALID_MERGE', 'Apenas estúdios individuais podem ser unidos.');
            flow.mergeSource = identity.workspaceId;
            return identity.workspaceId;
          }
          if (s.workspaces.some(w => w.id === workspaceId && w.kind === 'user') && !identity)
            s.identities.push({ provider, externalId: ids[0], workspaceId });
          return workspaceId;
        });
      } catch (e) {
        if (loginId) this.reject(loginId, e);
        throw e;
      }
    },
    complete(id, workspaceId) {
      if (!id) return;
      if (!repository.snapshot().workspaces.some(w => w.id === workspaceId))
        fail(400, 'LOGIN_EXPIRED', 'Estúdio excluído. Entre novamente.');
      const c = challenge(id);
      c.status = c.mergeSource ? 'review' : 'ready';
      c.workspaceId = workspaceId;
    },
    needsMerge(id) {
      return pending.get(id)?.status === 'review';
    },
    async merge(workspaceId, id, secret, confirm) {
      prune();
      const c = pending.get(id);
      if (
        !c ||
        c.status !== 'review' ||
        c.targetWorkspaceId !== workspaceId ||
        typeof secret !== 'string' ||
        c.secret !== hash(secret)
      )
        fail(403, 'INVALID_MERGE', 'A confirmação expirou ou pertence a outro estúdio.');
      if (confirm !== true) {
        pending.delete(id);
        return { status: 'cancelled' };
      }
      const source = c.mergeSource,
        target = workspaceId;
      await repository.update(s => {
        if (![source, target].every(id => s.workspaces.some(w => w.id === id && w.kind === 'user' && !w.mergedInto)))
          fail(409, 'INVALID_MERGE', 'Um dos estúdios foi alterado. Autorize novamente.');
        if ((s.syncJobs ?? []).some(j => [source, target].includes(j.workspaceId) && j.status === 'running'))
          fail(409, 'MERGE_SYNC_BUSY', 'Aguarde a sincronização atual terminar e confirme novamente.');
        const moved = {};
        // Sessions of the source studio are revoked, never transferred to the target.
        if (s.authSessions) s.authSessions = s.authSessions.filter(v => v.workspaceId !== source);
        for (const [key, rows] of Object.entries(s))
          if (Array.isArray(rows) && key !== 'workspaces' && key !== 'authSessions') {
            for (const row of rows) {
              if (key === 'syncJobs' && [source, target].includes(row.workspaceId) && row.status === 'queued') {
                row.status = 'cancelled';
                row.phase = 'Estudios unidos';
              }
              if (row.workspaceId === source) {
                row.workspaceId = target;
                moved[key] = (moved[key] ?? 0) + 1;
              }
            }
          }
        Object.assign(
          s.workspaces.find(w => w.id === source),
          { kind: 'merged', mergedInto: target, mergedAt: new Date(now()).toISOString() },
        );
        s.workspaceMerges ??= [];
        s.workspaceMerges.push({
          id: randomUUID(),
          source,
          target,
          provider: c.provider,
          moved,
          createdAt: new Date(now()).toISOString(),
        });
      });
      dropSessions(value => value.workspaceId === source);
      for (const [key, value] of pending) if (key !== id && value.targetWorkspaceId === source) value.status = 'denied';
      pending.delete(id);
      return { status: 'connected', workspaceId: target };
    },
    poll(id, secret) {
      prune();
      const c = pending.get(id);
      if (!c || typeof secret !== 'string' || c.secret !== hash(secret))
        fail(400, 'LOGIN_EXPIRED', 'Login expirado. Inicie novamente.');
      if (c.status === 'denied') {
        pending.delete(id);
        fail(403, c.error?.code ?? 'LOGIN_DENIED', c.error?.message ?? 'Login cancelado ou recusado.');
      }
      if (c.status === 'review') {
        const state = repository.snapshot(),
          source = c.mergeSource;
        return {
          status: 'merge_required',
          sourceChannels: state.channels
            .filter(v => v.workspaceId === source)
            .map(v => ({ name: v.name, platform: v.platform })),
          counts: Object.fromEntries(
            ['contents', 'comments', 'plans', 'playlists', 'financial'].map(key => [
              key,
              (state[key] ?? []).filter(v => v.workspaceId === source).length,
            ]),
          ),
        };
      }
      if (c.status !== 'ready') return { status: 'pending' };
      for (let i = 0; i < 32; i++) {
        const destination = repository.snapshot().workspaces.find(w => w.id === c.workspaceId)?.mergedInto;
        if (!destination) break;
        c.workspaceId = destination;
      }
      if (c.kind === 'connection') {
        pending.delete(id);
        return { status: 'connected', workspaceId: c.workspaceId };
      }
      const primaryChannelId =
        repository
          .read()
          .channels.find(
            v => v.workspaceId === c.workspaceId && v.platform === c.provider && v.externalId === c.primaryExternalId,
          )?.id ?? null;
      const accessToken = random();
      sessions.set(hash(accessToken), {
        workspaceId: c.workspaceId,
        primaryChannelId,
        expires: now() + SESSION_MS,
        startedAt: now(),
      });
      void saveSessions();
      pending.delete(id);
      return {
        status: 'connected',
        accessToken,
        workspaceId: c.workspaceId,
        primaryChannelId,
        expiresIn: SESSION_MS / 1000,
      };
    },
    session(value) {
      prune();
      return typeof value === 'string' ? (sessions.get(hash(value)) ?? null) : null;
    },
    invalidateWorkspace(w, extra = []) {
      dropSessions(value => value.workspaceId === w);
      for (const value of pending.values())
        if (value.workspaceId === w || value.targetWorkspaceId === w || value.mergeSource === w)
          value.status = 'denied';
      const identities = [...(repository.snapshot().identities ?? []).filter(v => v.workspaceId === w), ...extra];
      for (const value of identities)
        revocations.set(hash(value.provider + '/' + value.externalId), { cutoff: now(), expires: now() + 600000 });
    },
    /**
     * Exchanges a valid session token for a new one with a fresh 12 h expiry (the old token stops working), so
     * someone using the dashboard is not signed out mid-task. Never beyond SESSION_MAX_MS after the sign-in.
     */
    async refresh(value) {
      prune();
      const key = typeof value === 'string' ? hash(value) : null;
      const current = key ? sessions.get(key) : null;
      if (!current) fail(401, 'UNAUTHORIZED', 'Sessão expirada. Entre novamente.');
      const limit = current.startedAt + SESSION_MAX_MS;
      if (limit - now() < 60000) fail(401, 'SESSION_MAX_AGE', 'Por segurança, entre novamente.');
      const accessToken = random(),
        expires = Math.min(now() + SESSION_MS, limit);
      sessions.delete(key);
      sessions.set(hash(accessToken), { ...current, expires });
      await saveSessions();
      return { accessToken, expiresIn: Math.floor((expires - now()) / 1000) };
    },
    /** Ends the session immediately; the returned promise resolves once the removal is persisted. */
    logout(value) {
      if (typeof value === 'string' && sessions.delete(hash(value))) return saveSessions();
      return Promise.resolve();
    },
  };
}
