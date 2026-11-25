import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../src/repository.js';
import { pruneImportedData } from '../src/retention.js';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const daysAgo = days => new Date(NOW - days * 86400000).toISOString();
const W = 'studio-live';

async function seeded() {
  const repository = await createRepository();
  await repository.update(s => {
    s.connections.push({ id: 'g-old', workspaceId: W, createdAt: daysAgo(100) });
    s.connections.push({ id: 'g-new', workspaceId: W, createdAt: daysAgo(100) });
    s.channels.push(
      {
        id: 'stale',
        workspaceId: W,
        platform: 'YouTube',
        externalId: 'UC-stale',
        connectionId: 'g-old',
        dataSource: 'youtube',
        name: 'Nome real',
        subscribers: 999,
        thumbnailUrl: 'https://i.ytimg.com/x.jpg',
        lastSyncedAt: daysAgo(40),
      },
      {
        id: 'fresh',
        workspaceId: W,
        platform: 'Twitch',
        externalId: '12',
        connectionId: 'g-new',
        dataSource: 'twitch',
        name: 'Canal ativo',
        followers: 10,
        lastSyncedAt: daysAgo(1),
      },
    );
    s.reports.push({ id: 'r-old', fetchedAt: daysAgo(30) }, { id: 'r-new', fetchedAt: daysAgo(28) });
    s.videoReports.push({ id: 'v-undated' });
    s.contents.push({ id: 'c-old', lastSyncedAt: daysAgo(35) }, { id: 'c-new', lastSyncedAt: daysAgo(2) });
    s.comments.push({ id: 'm-bad-date', lastSyncedAt: 'not-a-date' });
    s.membershipSnapshots.push({ id: 'ms-new', checkedAt: daysAgo(3) });
    s.streamSnapshots = [{ id: 'ss-old', observedAt: daysAgo(60) }];
    s.syncJobs.push(
      { id: 'running-old', status: 'running', createdAt: daysAgo(20) },
      { id: 'done-old', status: 'completed', finishedAt: daysAgo(8) },
      { id: 'done-new', status: 'completed', finishedAt: daysAgo(6) },
    );
    s.pendingRevocations = [
      { id: 'expired', expiresAt: NOW - 1 },
      // The repository also drops revocations expired by the real clock, so keep this one valid in real time too.
      { id: 'pending', expiresAt: Date.now() + 86400000 },
    ];
  });
  return repository;
}

test('imported platform data older than 29 days (or undated) is removed; recent data stays', async () => {
  const repository = await seeded();
  const { removed } = await pruneImportedData(repository, NOW);
  const s = repository.read();
  const ids = key => (s[key] ?? []).map(v => v.id);
  assert.deepEqual(ids('reports'), ['r-new']);
  assert.deepEqual(ids('videoReports'), []);
  assert.deepEqual(ids('contents'), ['c-new']);
  assert.deepEqual(ids('comments'), []);
  assert.deepEqual(ids('membershipSnapshots'), ['ms-new']);
  assert.deepEqual(ids('streamSnapshots'), []);
  assert.equal(removed, 5);
});

test('job history keeps active jobs and 7 days of finished ones; expired revocations are dropped', async () => {
  const repository = await seeded();
  await pruneImportedData(repository, NOW);
  const s = repository.read();
  assert.deepEqual(
    s.syncJobs.map(j => j.id),
    ['running-old', 'done-new'],
  );
  assert.deepEqual(
    s.pendingRevocations.map(v => v.id),
    ['pending'],
  );
});

test('a channel not collected for 29 days keeps only its identifiers; active channels are untouched', async () => {
  const repository = await seeded();
  await pruneImportedData(repository, NOW);
  const [stale, fresh] = repository.read().channels;
  assert.deepEqual(stale, {
    id: 'stale',
    workspaceId: W,
    platform: 'YouTube',
    externalId: 'UC-stale',
    connectionId: 'g-old',
    dataSource: 'youtube',
    lastSyncedAt: daysAgo(40),
    name: 'Canal conectado',
    thumbnailUrl: null,
  });
  assert.equal(fresh.name, 'Canal ativo');
  assert.equal(fresh.followers, 10);
});
