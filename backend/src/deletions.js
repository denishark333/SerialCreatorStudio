import { createHash } from 'node:crypto';
export const deletionHash = value => createHash('sha256').update(String(value)).digest('hex');
export function applyDeletionJournal(state, journal, now = Date.now()) {
  const live = journal.filter(v => v.expiresAt > now),
    byHash = new Map(state.workspaces.map(v => [deletionHash(v.id), v.id]));
  const completed = new Set(live.flatMap(v => v.revokedJobIds ?? []));
  state.pendingRevocations = (state.pendingRevocations ?? []).filter(v => !completed.has(v.id) && v.expiresAt > now);
  for (const entry of live) {
    entry.revocations = (entry.revocations ?? []).filter(v => v.expiresAt > now);
    for (const job of entry.revocations)
      if (!state.pendingRevocations.some(v => v.id === job.id)) state.pendingRevocations.push(job);
  }
  for (const entry of live) {
    const ids = new Set(entry.workspaceHashes.map(hash => byHash.get(hash)).filter(Boolean));
    if (!ids.size) continue;
    let channels = new Set(),
      contentIds = new Set(),
      identities = [];
    if (entry.connectionHash) {
      const grants = state.connections.filter(
        v =>
          ids.has(v.workspaceId) &&
          deletionHash(v.id) === entry.connectionHash &&
          (!v.createdAt || Date.parse(v.createdAt) <= entry.deletedAt),
      );
      if (!grants.length) continue;
      const grantIds = new Set(grants.map(v => v.id));
      channels = new Set(grants.flatMap(v => v.channelIds));
      contentIds = new Set(
        state.contents.filter(v => ids.has(v.workspaceId) && channels.has(v.channelId)).map(v => v.id),
      );
      identities = state.channels
        .filter(v => ids.has(v.workspaceId) && channels.has(v.id))
        .map(v => ({ provider: v.platform, externalId: v.externalId }));
      for (const [key, rows] of Object.entries(state))
        if (Array.isArray(rows) && !['workspaces', 'pendingRevocations', 'deletionJournal'].includes(key))
          state[key] = rows.filter(v => {
            if (!ids.has(v.workspaceId)) return true;
            if (key === 'connections') return !grantIds.has(v.id);
            if (key === 'identities')
              return !identities.some(i => i.provider === v.provider && i.externalId === v.externalId);
            if (key === 'syncJobs') return false;
            return (
              !channels.has(v.id) &&
              !channels.has(v.channelId) &&
              !contentIds.has(v.contentId) &&
              !grantIds.has(v.connectionId)
            );
          });
    } else {
      for (const [key, rows] of Object.entries(state))
        if (Array.isArray(rows) && !['pendingRevocations', 'deletionJournal'].includes(key))
          state[key] = rows.filter(v =>
            key === 'workspaces'
              ? !ids.has(v.id)
              : key === 'workspaceMerges'
                ? !ids.has(v.source) && !ids.has(v.target)
                : !ids.has(v.workspaceId),
          );
    }
  }
  state.deletionJournal = live;
  return state;
}
