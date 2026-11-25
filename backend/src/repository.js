import { resolve } from 'node:path';
import { emptyState } from './model.js';
import { applyDeletionJournal } from './deletions.js';
import { createFileStorage, createJournalFile } from './storage/file.js';
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
/**
 * Single-process repository: the state lives in memory (frozen snapshots), every update is persisted before it
 * becomes visible. Storage: `storage` (PostgreSQL, see storage/postgres.js) or a JSON `file`; none = memory only.
 * The privacy deletion journal stays in its own file (`journal`, default next to `file`).
 */
export async function createRepository({ file, initial, cleanDemo = true, storage, journal } = {}) {
  const filename = file ? resolve(file) : null;
  storage ??= filename ? createFileStorage(filename) : null;
  journal ??= filename ? createJournalFile(filename + '.privacy-journal.json') : null;
  const savedJournal = await journal?.load();
  let durableJournal = savedJournal ?? [],
    journalSaved = savedJournal ? JSON.stringify(savedJournal) : null;
  let state = await storage?.load();
  const mergeJournal = rows => {
    const merged = new Map();
    for (const entry of [...durableJournal, ...(rows ?? [])]) {
      const key = entry.id ?? JSON.stringify(entry),
        prior = merged.get(key);
      if (!prior || (entry.revision ?? 0) >= (prior.revision ?? 0)) merged.set(key, entry);
    }
    return [...merged.values()];
  };
  state ??= initial ?? emptyState();
  applyDeletionJournal(state, mergeJournal(state.deletionJournal));
  if (cleanDemo) {
    const demoIds = new Set(
      state.channels.filter(c => c.dataSource === 'demo' || c.workspaceId === 'studio-demo').map(c => c.id),
    );
    const hasDemo = state.workspaces.some(w => w.id === 'studio-demo') || demoIds.size > 0;
    if (hasDemo) {
      await storage?.backup?.(state);
      for (const key of [
        'workspaces',
        'channels',
        'connections',
        'contents',
        'metrics',
        'plans',
        'comments',
        'reports',
        'videoReports',
        'playlists',
        'financial',
        'membershipSnapshots',
        'syncJobs',
      ])
        if (Array.isArray(state[key]))
          state[key] = state[key].filter(
            v =>
              v.workspaceId !== 'studio-demo' &&
              v.id !== 'studio-demo' &&
              v.dataSource !== 'demo' &&
              !demoIds.has(v.channelId),
          );
    }
  }
  if (!state.workspaces.some(w => w.id === 'studio-live')) state.workspaces.push(emptyState().workspaces[0]);
  if (state.schemaVersion !== 1) throw new Error('Unsupported data schema version');
  let queue = Promise.resolve();
  async function persist(next) {
    applyDeletionJournal(next, mergeJournal(next.deletionJournal));
    // Own copy: `next` becomes the frozen state, and journal entries are mutated by later merges.
    durableJournal = structuredClone(next.deletionJournal);
    if (journal) {
      const serializedJournal = JSON.stringify(durableJournal);
      if (serializedJournal !== journalSaved) {
        await journal.save(serializedJournal);
        journalSaved = serializedJournal;
      }
    }
    await storage?.save(next);
  }
  await persist(state);
  state = deepFreeze(state);
  return {
    /** 'postgres', 'file' or 'memory'. */
    kind: storage?.kind ?? 'memory',
    /** Waits for pending writes, then releases the storage (database connections). */
    close: () => queue.then(() => storage?.close?.()),
    /** Mutable deep copy. Use when the caller may change the result. */
    read: () => structuredClone(state),
    /** Read-only view without copying (deeply frozen; writes throw). Preferred for hot request paths. */
    snapshot: () => state,
    update: fn => {
      const operation = queue.then(async () => {
        const next = structuredClone(state);
        const result = fn(next);
        await persist(next);
        state = deepFreeze(next);
        return structuredClone(result);
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
