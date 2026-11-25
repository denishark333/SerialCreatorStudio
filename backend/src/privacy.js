import { randomUUID } from 'node:crypto';
import { fail } from './errors.js';
import { deletionHash } from './deletions.js';
const DAY = 86400000;
const related = (s, w) => {
  const ids = new Set([w]);
  let previous;
  do {
    previous = ids.size;
    for (const row of s.workspaces) if (ids.has(row.mergedInto)) ids.add(row.id);
  } while (previous !== ids.size);
  return ids;
};
export function createPrivacy({
  repository,
  auth,
  youtube = null,
  streams = null,
  revoke = async () => {
    throw Error('REVOCATION_NOT_CONFIGURED');
  },
  now = () => Date.now(),
}) {
  const locks = new Set(),
    readers = new Map();
  let worker = null,
    timer;
  function enter(w) {
    if (locks.has(w)) fail(409, 'PRIVACY_IN_PROGRESS', 'A exclusão dos dados está em andamento.');
    readers.set(w, (readers.get(w) ?? 0) + 1);
    return () => {
      const n = (readers.get(w) ?? 1) - 1;
      if (n) readers.set(w, n);
      else readers.delete(w);
    };
  }
  function preview(w) {
    const s = repository.snapshot(),
      workspace = s.workspaces.find(v => v.id === w);
    if (!workspace) fail(404, 'WORKSPACE_NOT_FOUND', 'Estúdio não encontrado.');
    const ids = related(s, w);
    return {
      canDelete: workspace.kind === 'user' && !workspace.mergedInto,
      mergedStudios: ids.size - 1,
      counts: Object.fromEntries(
        Object.entries(s)
          .filter(([key, rows]) => Array.isArray(rows) && !['workspaces', 'pendingRevocations'].includes(key))
          .map(([key, rows]) => [key, rows.filter(v => ids.has(v.workspaceId)).length]),
      ),
      connections: s.connections
        .filter(v => ids.has(v.workspaceId))
        .map(v => ({ id: v.id, platform: v.platform, channelIds: v.channelIds })),
      revocationRetryDays: 6,
      backupDeletion: 'managed_by_operator',
    };
  }
  function work() {
    if (worker) return worker;
    worker = (async () => {
      const due = (repository.snapshot().pendingRevocations ?? []).filter(
        v => v.expiresAt <= now() || v.nextAttemptAt <= now(),
      );
      for (const item of due) {
        let success = false;
        if (item.expiresAt > now())
          try {
            await revoke(item);
            success = true;
          } catch {
            /* Never retain or log provider errors, tokens or response bodies. */
          }
        await repository.update(s => {
          const current = (s.pendingRevocations ?? []).find(v => v.id === item.id);
          if (!current) return;
          if (success || current.expiresAt <= now()) {
            s.pendingRevocations = s.pendingRevocations.filter(v => v.id !== item.id);
            for (const entry of s.deletionJournal ?? [])
              if (entry.revocations?.some(v => v.id === item.id)) {
                entry.revocations = entry.revocations.filter(v => v.id !== item.id);
                entry.revokedJobIds = [...(entry.revokedJobIds ?? []), item.id];
                entry.revision = (entry.revision ?? 0) + 1;
              }
          } else {
            current.attempts++;
            current.nextAttemptAt = now() + Math.min(6 * 3600000, 60000 * 2 ** Math.min(current.attempts, 8));
          }
        });
      }
    })().finally(() => {
      worker = null;
    });
    return worker;
  }
  async function erase(w, connectionId = null) {
    if (locks.has(w)) fail(409, 'PRIVACY_IN_PROGRESS', 'A exclusão já está em andamento.');
    locks.add(w);
    try {
      let snapshot = repository.snapshot();
      if (
        (readers.get(w) ?? 0) > 0 ||
        snapshot.syncJobs?.some(v => v.workspaceId === w && v.status === 'running') ||
        youtube?.busyWorkspace?.(w) ||
        streams?.busyWorkspace?.(w)
      )
        fail(409, 'WORKSPACE_BUSY', 'Aguarde a sincronização e as ações em andamento antes de excluir os dados.');
      const workspace = snapshot.workspaces.find(v => v.id === w);
      if (!workspace) fail(404, 'WORKSPACE_NOT_FOUND', 'Estúdio não encontrado.');
      if (!connectionId && (workspace.kind !== 'user' || workspace.mergedInto))
        fail(403, 'PERSONAL_WORKSPACE_REQUIRED', 'Entre com uma conta pessoal para excluir seu estúdio.');
      const ids = related(snapshot, w),
        grant = connectionId ? snapshot.connections.find(v => v.workspaceId === w && v.id === connectionId) : null;
      if (connectionId && !grant) fail(404, 'CONNECTION_NOT_FOUND', 'Conexão não encontrada.');
      const removeStudio =
        !connectionId ||
        (workspace.kind === 'user' &&
          !snapshot.connections.some(c => ids.has(c.workspaceId) && c.id !== connectionId) &&
          !snapshot.channels.some(c => ids.has(c.workspaceId) && !grant.channelIds.includes(c.id)));
      const channels = new Set(
        connectionId ? grant.channelIds : snapshot.channels.filter(c => ids.has(c.workspaceId)).map(c => c.id),
      );
      const contentIds = new Set(
        snapshot.contents.filter(c => ids.has(c.workspaceId) && channels.has(c.channelId)).map(c => c.id),
      );
      const identities = snapshot.channels
        .filter(c => ids.has(c.workspaceId) && channels.has(c.id))
        .map(c => ({ provider: c.platform, externalId: c.externalId }));
      // Revoke every old session and pending connection flow before awaiting persistence.
      for (const id of ids) auth?.invalidateWorkspace?.(id, identities);
      const queued = await repository.update(s => {
        if (s.syncJobs?.some(v => ids.has(v.workspaceId) && v.status === 'running'))
          fail(409, 'WORKSPACE_BUSY', 'A coleta foi iniciada. Aguarde e tente novamente.');
        const grants = s.connections.filter(c => ids.has(c.workspaceId) && (!connectionId || c.id === connectionId)),
          jobs = grants
            .filter(c => c.encryptedTokens)
            .map(c => ({
              id: randomUUID(),
              platform: c.platform,
              encryptedTokens: c.encryptedTokens,
              createdAt: now(),
              nextAttemptAt: now(),
              expiresAt: now() + 6 * DAY,
              attempts: 0,
            }));
        for (const [key, rows] of Object.entries(s))
          if (Array.isArray(rows) && !['workspaces', 'pendingRevocations'].includes(key))
            s[key] = rows.filter(row => {
              if (key === 'workspaceMerges') return !ids.has(row.source) && !ids.has(row.target);
              if (!ids.has(row.workspaceId)) return true;
              if (removeStudio) return false;
              if (key === 'connections') return row.id !== connectionId;
              if (key === 'identities')
                return !identities.some(i => i.provider === row.provider && i.externalId === row.externalId);
              if (key === 'syncJobs') return false;
              return (
                !channels.has(row.id) &&
                !channels.has(row.channelId) &&
                !contentIds.has(row.contentId) &&
                row.connectionId !== connectionId
              );
            });
        if (removeStudio) s.workspaces = s.workspaces.filter(row => !ids.has(row.id));
        s.pendingRevocations ??= [];
        s.pendingRevocations.push(...jobs);
        s.deletionJournal ??= [];
        s.deletionJournal.push({
          id: randomUUID(),
          revision: 0,
          workspaceHashes: [...ids].map(deletionHash),
          connectionHash: removeStudio ? null : deletionHash(connectionId),
          deletedAt: now(),
          expiresAt: now() + 7 * DAY,
          revocations: jobs,
        });
        return jobs.map(v => v.id);
      });
      // Deletion has committed. Revocation is durable and attempted immediately in background.
      void work().catch(() => {});
      return {
        deleted: true,
        sessionEnded: true,
        revocation: queued.length ? 'queued' : 'not_needed',
        message: queued.length
          ? 'Dados ativos excluídos. A revogação será tentada imediatamente e repetida por até seis dias se a plataforma estiver indisponível.'
          : 'Dados ativos excluídos.',
      };
    } finally {
      locks.delete(w);
    }
  }
  return {
    enter,
    preview,
    erase,
    work,
    start() {
      void work().catch(() => {});
      timer = setInterval(() => void work().catch(() => {}), 60000);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    isLocked: w => locks.has(w),
  };
}
