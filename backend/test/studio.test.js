import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRepository as createRepository } from './fixtures/repository.js';
import { createStudio } from '../src/studio.js';
import { createApp } from '../src/app.js';
async function fixture() {
  const repository = await createRepository();
  await repository.update(s => {
    s.workspaces.push({ id: 'studio-live', name: 'Real' });
    s.channels.push({
      id: 'channel',
      workspaceId: 'studio-live',
      externalId: 'UCtest',
      platform: 'YouTube',
      dataSource: 'youtube',
      name: 'Real',
      subscribers: 10,
    });
    s.contents.push({
      id: 'vid',
      workspaceId: 'studio-live',
      channelId: 'channel',
      externalId: 'v1',
      title: 'Video real',
      tags: ['game'],
      format: 'Vídeo',
      date: '2026-11-01',
      publishedAt: '2026-11-01T12:00:00Z',
      views: 100,
      dataSource: 'youtube',
    });
    s.comments.push({
      id: 'comment',
      externalId: 'c1',
      workspaceId: 'studio-live',
      channelId: 'channel',
      videoId: 'v1',
      author: 'Viewer',
      text: 'A question?',
      publishedAt: '2026-11-01T12:00:00Z',
      replies: [],
      replyCount: 0,
    });
  });
  let writes = 0;
  const moderated = [];
  const youtube = {
    status: () => ({ configured: true, items: [] }),
    runChannelTask: async (w, id, fn) => {
      const channel = repository.read().channels.find(c => c.workspaceId === w && c.id === id);
      assert.ok(channel);
      return fn({
        channel,
        scopes: [
          'https://www.googleapis.com/auth/youtube.force-ssl',
          'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
        ],
        moderateComment: async (commentId, status) => {
          assert.equal(commentId, 'c1');
          assert.ok(['heldForReview', 'rejected', 'published'].includes(status));
          moderated.push(status);
        },
        publishReply: async (parentId, text) => {
          writes++;
          assert.equal(parentId, 'c1');
          return { id: 'reply-google' };
        },
        data: async resource =>
          resource === 'playlists'
            ? {
                items: [
                  {
                    id: 'pl',
                    snippet: { title: 'My playlist', description: 'Desc' },
                    contentDetails: { itemCount: 2 },
                    status: { privacyStatus: 'public' },
                  },
                ],
              }
            : {
                items: [
                  { id: 'pi1', contentDetails: { videoId: 'v1' }, snippet: { title: 'Video real', position: 0 } },
                ],
                nextPageToken: 'next',
              },
        report: async query =>
          query.dimensions === 'video,creatorContentType'
            ? {
                columnHeaders: [{ name: 'video' }, { name: 'creatorContentType' }, { name: 'views' }],
                rows: [['v1', 'shorts', 100]],
              }
            : {
                columnHeaders: [
                  { name: 'views' },
                  { name: 'estimatedMinutesWatched' },
                  { name: 'averageViewPercentage' },
                ],
                rows: [[100, 50, 60]],
              },
      });
    },
  };
  return { repository, youtube, studio: createStudio({ repository, youtube }), writes: () => writes, moderated };
}
const w = 'studio-live',
  p = new URLSearchParams({ from: '2026-11-01', to: '2026-11-13' });
test('classification normalizes lowercase shorts and replaces incorrect manual labels', async () => {
  const f = await fixture();
  assert.equal((await f.studio.classify(w, 'channel', p)).updated, 1);
  assert.equal(f.repository.read().contents.find(c => c.id === 'vid').format, 'Short');
  await f.studio.setFormat(w, 'vid', { format: 'Vídeo' });
  await f.studio.classify(w, 'channel', p);
  assert.equal(f.repository.read().contents.find(c => c.id === 'vid').format, 'Short');
  assert.equal(f.studio.catalog(w, new URLSearchParams({ q: 'game' })).length, 1);
  assert.equal(f.studio.summary(w, p).shorts, 1);
});
test('playlists and per-video reports are persisted without mixing periods', async () => {
  const f = await fixture();
  await f.studio.syncPlaylists(w, 'channel');
  const playlists = f.studio.playlists(w, p);
  assert.equal(playlists.length, 1);
  assert.equal(playlists[0].items[0].videoId, 'v1');
  assert.equal(playlists[0].itemCount, 2);
  await f.studio.syncVideo(w, 'vid', p);
  assert.equal(f.studio.details(w, 'vid', p).summary.views, 100);
  assert.equal(f.studio.details(w, 'vid', new URLSearchParams({ from: '2025-01-01', to: '2025-01-10' })).report, null);
});
test('hide is reversible (held for review); replies wait until the comment is republished', async () => {
  const f = await fixture();
  await f.studio.moderate(w, 'comment', { status: 'heldForReview' });
  assert.deepEqual(f.moderated, ['heldForReview']);
  assert.equal(f.writes(), 0);
  assert.equal(f.studio.comments(w, p).length, 0, 'hidden comments leave the main list');
  assert.equal(f.studio.comments(w, new URLSearchParams({ filter: 'hidden' }))[0].video.title, 'Video real');
  await assert.rejects(f.studio.reply(w, 'comment', { text: 'Oi', requestId: 'early' }), { code: 'COMMENT_HIDDEN' });
  assert.equal(f.writes(), 0, 'nothing is sent to YouTube for a hidden comment');
  await f.studio.moderate(w, 'comment', { status: 'published' });
  assert.equal(f.studio.comments(w, p).length, 1, 'republished comments return to the main list');
  assert.equal(f.studio.comments(w, new URLSearchParams({ filter: 'hidden' })).length, 0);
  const first = await f.studio.reply(w, 'comment', { text: 'Obrigado!', requestId: 'request-1' });
  const second = await f.studio.reply(w, 'comment', { text: 'Obrigado!', requestId: 'request-1' });
  assert.equal(first.id, second.id);
  assert.equal(first.delivery, 'published');
  assert.equal(f.writes(), 1);
  assert.equal(f.studio.comments(w, new URLSearchParams({ filter: 'answered' })).length, 1);
  await assert.rejects(f.studio.reply('studio-demo', 'comment', { text: 'No', requestId: 'x' }), { code: 'NOT_FOUND' });
});

test('delete (rejected) removes the comment for good, also from the local store', async () => {
  const f = await fixture();
  const result = await f.studio.moderate(w, 'comment', { status: 'rejected' });
  assert.deepEqual(f.moderated, ['rejected']);
  assert.equal(result.deleted, true);
  assert.equal(f.studio.comments(w, p).length, 0);
  assert.equal(f.studio.comments(w, new URLSearchParams({ filter: 'hidden' })).length, 0, 'not listed as hidden');
  assert.equal(
    f.repository.read().comments.some(c => c.id === 'comment'),
    false,
  );
  await assert.rejects(f.studio.moderate(w, 'comment', { status: 'published' }), { code: 'NOT_FOUND' });
});
test('manual finances validate money, keep currencies separate and support stage updates', async () => {
  const f = await fixture();
  const row = await f.studio.saveFinancial(w, {
    type: 'deal',
    title: 'Brand',
    channelId: 'channel',
    amount: 12.34,
    currency: 'BRL',
    date: '2026-11-10',
    stage: 'Proposta',
  });
  assert.equal(row.amountCents, 1234);
  assert.equal(row.source, 'manual');
  await f.studio.updateFinancial(w, row.id, { stage: 'Recebido' });
  assert.equal(f.studio.financial(w, p, 'deal')[0].stage, 'Recebido');
  await assert.rejects(
    f.studio.saveFinancial(w, {
      type: 'payout',
      title: 'Invalid',
      channelId: 'channel',
      amount: 1.234,
      currency: 'USD',
      date: '2026-11-10',
      stage: 'Previsto',
    }),
    { code: 'INVALID_AMOUNT' },
  );
  await assert.rejects(
    f.studio.saveFinancial(w, {
      type: 'deal',
      title: 'Cross workspace',
      channelId: 'youtube-main',
      amount: 2,
      currency: 'USD',
      date: '2026-11-10',
      stage: 'Proposta',
    }),
    { code: 'CHANNEL_NOT_FOUND' },
  );
  await f.studio.deleteFinancial(w, row.id);
  assert.equal(f.studio.financial(w, p, 'deal').length, 0);
});
test('HTTP studio endpoints isolate reads and expose only explicit reply publishing', async t => {
  const f = await fixture(),
    app = createApp({ repository: f.repository, youtube: f.youtube });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  t.after(
    () =>
      new Promise(r => {
        app.close(r);
        app.closeAllConnections();
      }),
  );
  const root = `http://127.0.0.1:${app.address().port}/api/v1/workspaces/studio-live`;
  const result = await (await fetch(root + '/catalog-summary')).json();
  assert.equal(result.data.videos, 1);
  const res = await fetch(root + '/community/comments/comment/publish-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Thanks!', requestId: 'explicit-click' }),
  });
  assert.equal(res.status, 201);
  assert.equal(f.writes(), 1);
  assert.equal((await fetch(root + '/catalog?externalId=nonexistent')).status, 200);
});

test('remote moderation failure does not claim a successful local hide', async () => {
  const f = await fixture();
  const broken = {
    ...f.youtube,
    runChannelTask: async (w, id, fn) =>
      fn({
        scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
        moderateComment: async () => {
          throw new Error('YouTube denied moderation');
        },
      }),
  };
  const studio = createStudio({ repository: f.repository, youtube: broken });
  await assert.rejects(studio.moderate('studio-live', 'comment', { status: 'rejected' }), /YouTube denied/);
  assert.equal(f.repository.read().comments.find(c => c.id === 'comment').youtubeModerationStatus, undefined);
});
test('goals: one per metric (YouTube subscribers by default, Twitch/Kick followers or paid subscribers)', async () => {
  const f = await fixture();
  assert.deepEqual(f.studio.goal(w), { metric: 'youtube.subscribers', target: null });
  await f.studio.setGoal(w, { target: 1000 });
  await f.studio.setGoal(w, { target: 500, metric: 'twitch.followers' });
  await f.studio.setGoal(w, { target: 20, metric: 'kick.subscribers' });
  const goal = metric => f.studio.goal(w, new URLSearchParams({ metric })).target;
  assert.equal(goal('youtube.subscribers'), 1000);
  assert.equal(goal('twitch.followers'), 500);
  assert.equal(goal('kick.subscribers'), 20);
  assert.equal(goal('twitch.subscribers'), null);
  assert.equal(f.repository.read().workspaces.find(v => v.id === w).subscriberGoal, 1000, 'legacy field kept');
  await assert.rejects(f.studio.setGoal(w, { target: 10, metric: 'twitch.views' }), e => e.status === 400);
  assert.throws(
    () => f.studio.goal(w, new URLSearchParams({ metric: 'x' })),
    e => e.status === 400,
  );
});
test('brand deals keep a delivery window and keywords; payouts do not take them', async () => {
  const f = await fixture();
  const deal = await f.studio.saveFinancial(w, {
    type: 'deal',
    title: 'Marca X',
    channelId: 'channel',
    amount: 100,
    currency: 'BRL',
    date: '2026-11-10',
    stage: 'Confirmado',
    endDate: '2026-11-16',
    keywords: [' marca x ', '#publi', '#publi'],
  });
  assert.equal(deal.endDate, '2026-11-16');
  assert.deepEqual(deal.keywords, ['marca x', '#publi']);
  const edited = await f.studio.updateFinancial(w, deal.id, { keywords: ['aion 2'], endDate: null });
  assert.deepEqual(edited.keywords, ['aion 2']);
  assert.equal(edited.endDate, null);
  assert.equal(edited.stage, 'Confirmado', 'stage untouched');
  await assert.rejects(f.studio.updateFinancial(w, deal.id, { endDate: '2026-11-01' }), e => e.status === 400);
  await assert.rejects(
    f.studio.saveFinancial(w, {
      type: 'payout',
      title: 'AdSense',
      channelId: 'channel',
      amount: 1,
      currency: 'USD',
      date: '2026-11-10',
      stage: 'Previsto',
      keywords: ['x'],
    }),
    e => e.status === 400,
  );
});
