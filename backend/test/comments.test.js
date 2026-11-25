import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRepository as createRepository } from './fixtures/repository.js';
import { createReports } from '../src/reports.js';

const w = 'studio-live';
const scopes = ['https://www.googleapis.com/auth/youtube.force-ssl'];

/** A channel whose comment threads are served in pages of `perPage`; counts every quota-consuming call. */
async function setup({ threads, perPage = 2 }) {
  const repository = await createRepository();
  await repository.update(s => {
    s.workspaces.push({ id: w, name: 'Real', timezone: 'America/Sao_Paulo' });
    s.channels.push({
      id: 'yt',
      workspaceId: w,
      name: 'Canal',
      platform: 'YouTube',
      externalId: 'UC-own',
      dataSource: 'youtube',
      connectionId: 'grant',
    });
  });
  const calls = { threads: 0, replies: 0 };
  const reply = (thread, n) => ({
    id: thread.id + '.r' + n,
    snippet: { textDisplay: 'resposta ' + n, authorDisplayName: 'Fã', publishedAt: '2026-01-02T00:00:00Z' },
  });
  const youtube = {
    runChannelTask: async (workspaceId, channelId, fn) =>
      fn({
        channel: repository.snapshot().channels.find(c => c.id === channelId),
        scopes,
        data: async (resource, params) => {
          if (resource === 'comments') {
            calls.replies++;
            const thread = threads.find(t => t.id === params.parentId);
            return { items: Array.from({ length: thread.replies }, (_, n) => reply(thread, n)) };
          }
          calls.threads++;
          assert.equal(params.part, 'snippet,replies');
          const start = params.pageToken ? Number(params.pageToken) : 0;
          const slice = threads.slice(start, start + perPage);
          return {
            items: slice.map(t => ({
              snippet: {
                topLevelComment: {
                  id: t.id,
                  snippet: { videoId: 'v', authorDisplayName: 'Fã', textDisplay: t.id, publishedAt: '2026-01-02' },
                },
                totalReplyCount: t.replies,
              },
              // The API returns at most a few replies inline.
              replies: t.replies
                ? { comments: Array.from({ length: Math.min(t.replies, 5) }, (_, n) => reply(t, n)) }
                : undefined,
            })),
            nextPageToken: start + perPage < threads.length ? String(start + perPage) : undefined,
          };
        },
      }),
  };
  const reports = createReports({ repository, youtube });
  const full = async () => {
    let result;
    do result = await reports.syncComments(w, 'yt');
    while (!result.complete);
  };
  return { repository, reports, calls, full };
}

test('replies that come inline with the thread cost no extra call; long threads are read in full', async () => {
  const f = await setup({
    threads: [
      { id: 'a', replies: 0 },
      { id: 'b', replies: 3 },
      { id: 'c', replies: 8 },
    ],
  });
  await f.full();
  assert.equal(f.calls.replies, 1, 'only the thread with more than 5 replies calls comments.list');
  const stored = Object.fromEntries(f.repository.read().comments.map(c => [c.externalId, c]));
  assert.equal(stored.b.replies.length, 3);
  assert.equal(stored.c.replies.length, 8);
});

test('incremental sync stops at the first fully known page and keeps unchanged replies without calls', async () => {
  const threads = [
    { id: 'a', replies: 8 },
    { id: 'b', replies: 8 },
    { id: 'c', replies: 8 },
    { id: 'd', replies: 8 },
    { id: 'e', replies: 8 },
    { id: 'f', replies: 8 },
  ];
  const f = await setup({ threads });
  await f.full();
  assert.equal(f.calls.threads, 3);
  assert.equal(f.calls.replies, 6);

  // Nothing changed: one page read, no reply calls.
  f.calls.threads = f.calls.replies = 0;
  const quiet = await f.reports.syncComments(w, 'yt', { mode: 'incremental' });
  assert.equal(quiet.complete, true);
  assert.equal(f.calls.threads, 1);
  assert.equal(f.calls.replies, 0);
  assert.equal(f.repository.read().comments.find(c => c.externalId === 'a').replies.length, 8, 'replies kept');

  // A new thread on top and a new reply on a known one: only those are read again.
  threads.unshift({ id: 'new', replies: 7 });
  threads[1].replies = 9; // 'a'
  f.calls.threads = f.calls.replies = 0;
  await f.reports.syncComments(w, 'yt', { mode: 'incremental' });
  assert.equal(f.calls.replies, 2, "'new' (unknown) and 'a' (reply count changed)");
  assert.ok(f.calls.threads >= 2 && f.calls.threads < 4, `stopped early: ${f.calls.threads} pages`);
  const stored = Object.fromEntries(f.repository.read().comments.map(c => [c.externalId, c]));
  assert.equal(stored.new.replies.length, 7);
  assert.equal(stored.a.replies.length, 9);
});

test('incremental sync leaves the full-sync cursor untouched', async () => {
  const f = await setup({ threads: Array.from({ length: 6 }, (_, i) => ({ id: 't' + i, replies: 0 })) });
  await f.reports.syncComments(w, 'yt'); // full mode, first page only
  const cursor = f.repository.read().channels.find(c => c.id === 'yt').commentsNextPageToken;
  assert.equal(cursor, '2');
  await f.reports.syncComments(w, 'yt', { mode: 'incremental' });
  assert.equal(f.repository.read().channels.find(c => c.id === 'yt').commentsNextPageToken, cursor);
});

test('a complete full pass removes comments deleted on YouTube, keeps hidden ones; incremental never removes', async () => {
  const threads = [
    { id: 'a', replies: 0 },
    { id: 'b', replies: 0 },
    { id: 'c', replies: 0 },
    { id: 'd', replies: 0 },
  ];
  const f = await setup({ threads });
  await f.full();
  const others = f.repository.read().comments.filter(c => c.channelId !== 'yt').length;
  const ids = () =>
    f.repository
      .read()
      .comments.filter(c => c.channelId === 'yt')
      .map(c => c.externalId)
      .sort();
  assert.deepEqual(ids(), ['a', 'b', 'c', 'd']);
  // 'b' is deleted on YouTube; 'c' is hidden (held for review), which the API no longer lists either.
  await f.repository.update(s => {
    s.comments.find(c => c.externalId === 'c').youtubeModerationStatus = 'heldForReview';
  });
  threads.splice(1, 2);
  await f.reports.syncComments(w, 'yt', { mode: 'incremental' });
  assert.deepEqual(ids(), ['a', 'b', 'c', 'd'], 'incremental passes do not remove anything');
  await new Promise(r => setTimeout(r, 5));
  await f.full();
  assert.deepEqual(ids(), ['a', 'c', 'd'], "the deleted 'b' is gone, the hidden 'c' stays");
  assert.equal(f.repository.read().channels.find(c => c.id === 'yt').commentsFullStartedAt, undefined);
  assert.equal(
    f.repository.read().comments.filter(c => c.channelId !== 'yt').length,
    others,
    'other channels untouched',
  );
});
