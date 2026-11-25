import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRepository as createRepository } from './fixtures/repository.js';
import { createReports } from '../src/reports.js';
import { createApp } from '../src/app.js';
const w = 'studio-live',
  analytics = 'https://www.googleapis.com/auth/yt-analytics.readonly',
  money = 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly';
const range = new URLSearchParams({ from: '2026-01-01', to: '2026-01-03' });
const response = (names, rows) => ({ columnHeaders: names.map(name => ({ name })), rows });
test('engagement ranking exposes only matching-period video interactions and preserves missing metrics', async () => {
  const { repository, reports } = await setup();
  await reports.sync(w, 'real-a', range);
  const scoped = new URLSearchParams({ ...Object.fromEntries(range), channelId: 'real-a' });
  assert.equal(reports.analytics(w, scoped).topContents[0].likes, null);
  await repository.update(s => {
    s.videoReports = [
      {
        workspaceId: w,
        contentId: 'real-video',
        from: '2025-01-01',
        to: '2025-01-03',
        summary: { rows: [{ likes: 999, comments: 999, shares: 999 }] },
      },
      {
        workspaceId: w,
        contentId: 'real-video',
        from: '2026-01-01',
        to: '2026-01-03',
        summary: { rows: [{ likes: 0, comments: 2, shares: 1 }] },
      },
    ];
  });
  const report = reports.analytics(w, scoped),
    video = report.topContents[0];
  assert.equal(video.likes, 0);
  assert.equal(video.comments, 2);
  assert.equal(video.shares, 1);
  assert.equal(report.timeseries[0].likes, 5);
  assert.equal(report.timeseries[0].subscribersGained, 3);
});
async function setup({
  scopes = [analytics, 'https://www.googleapis.com/auth/youtube.force-ssl'],
  noData = false,
  failCountry = false,
} = {}) {
  const repository = await createRepository();
  await repository.update(s => {
    s.workspaces.push({ id: w, name: 'Real', timezone: 'America/Sao_Paulo' });
    s.channels.push(
      {
        id: 'real-a',
        workspaceId: w,
        name: 'A',
        platform: 'YouTube',
        externalId: 'UC-a',
        dataSource: 'youtube',
        subscribers: 123,
        connectionId: 'grant-a',
      },
      {
        id: 'real-b',
        workspaceId: w,
        name: 'B',
        platform: 'YouTube',
        externalId: 'UC-b',
        dataSource: 'youtube',
        subscribers: 50,
        connectionId: 'grant-b',
      },
    );
    s.contents.push({
      id: 'real-video',
      externalId: 'video-a',
      workspaceId: w,
      channelId: 'real-a',
      platform: 'YouTube',
      title: 'Private title',
      publishedAt: '2025-01-01T00:00:00Z',
      views: 500,
      dataSource: 'youtube',
    });
  });
  const youtube = {
    status: () => ({ configured: true, items: [] }),
    runChannelTask: async (workspaceId, channelId, fn) => {
      const channel = repository.read().channels.find(c => c.workspaceId === workspaceId && c.id === channelId);
      if (!channel) {
        const e = new Error('Not found');
        e.status = 404;
        throw e;
      }
      return fn({
        channel,
        scopes,
        data: async resource =>
          resource === 'channels'
            ? { items: [{ statistics: { subscriberCount: '125', viewCount: '500', videoCount: '1' } }] }
            : {
                items: [
                  {
                    snippet: {
                      topLevelComment: {
                        id: 'comment-1',
                        snippet: {
                          videoId: 'video-a',
                          authorDisplayName: 'Viewer',
                          textDisplay: 'Real comment',
                          publishedAt: '2026-01-02T12:00:00Z',
                          likeCount: 4,
                        },
                      },
                      totalReplyCount: 2,
                    },
                  },
                ],
              },
        report: async params => {
          if (noData) return response(params.dimensions === 'day' ? ['day', 'views'] : ['video', 'views'], []);
          if (params.metrics === 'estimatedRevenue')
            return response(['day', 'estimatedRevenue'], [['2026-01-01', 3.25]]);
          if (params.dimensions === 'day')
            return response(
              [
                'day',
                'views',
                'estimatedMinutesWatched',
                'likes',
                'comments',
                'shares',
                'subscribersGained',
                'subscribersLost',
              ],
              [
                ['2026-01-01', 100, 240, 5, 2, 1, 3, 1],
                ['2026-01-02', 50, 60, 2, 1, 0, 1, 0],
              ],
            );
          if (params.dimensions === 'video')
            return response(
              ['video', 'views', 'estimatedMinutesWatched', 'averageViewPercentage'],
              [['video-a', 150, 300, 55]],
            );
          if (params.dimensions === 'country') {
            if (failCountry) throw new Error('Restricted report');
            return response(['country', 'views'], [['BR', 150]]);
          }
          return response(['deviceType', 'views'], [['MOBILE', 150]]);
        },
      });
    },
  };
  return { repository, youtube, reports: createReports({ repository, youtube }) };
}
test('private reports aggregate only matching workspace, channel and requested interval', async () => {
  const { reports, repository } = await setup();
  await reports.sync(w, 'real-a', range);
  let result = reports.analytics(w, new URLSearchParams({ ...Object.fromEntries(range), channelId: 'real-a' }));
  assert.equal(result.summary.views, 150);
  assert.equal(result.summary.watchTimeMinutes, 300);
  assert.equal(result.summary.subscribers, 125);
  assert.equal(result.summary.subscribersGained, 4);
  assert.equal(result.timeseries.length, 2);
  assert.equal(result.dataThrough, '2026-01-02');
  assert.equal(result.topContents[0].title, 'Private title');
  assert.equal(result.topContents[0].averageViewPercentage, 55);
  assert.equal(result.audience.countries.items[0].label, 'BR');
  assert.equal(repository.read().reports.length, 1);
  await reports.sync(w, 'real-a', range);
  assert.equal(repository.read().reports.length, 1);
  result = reports.analytics(w, new URLSearchParams({ from: '2026-01-01', to: '2026-02-01', channelId: 'real-a' }));
  assert.equal(result.summary.views, null);
  assert.equal(result.coverage[0].status, 'not_synced');
  assert.throws(() => reports.analytics(w, new URLSearchParams({ channelId: 'youtube-main' })), {
    code: 'CHANNEL_NOT_FOUND',
  });
});
test('missing channel reports prevent misleading complete totals; reports never mingle with demo', async () => {
  const { reports } = await setup();
  await reports.sync(w, 'real-a', range);
  const all = reports.analytics(w, range);
  assert.equal(all.status, 'partial');
  assert.equal(all.summary.views, null);
  assert.deepEqual(all.timeseries, []);
  assert.equal(all.coverage.length, 2);
  assert.equal(all.coverage[1].status, 'not_synced');
  await reports.sync(w, 'real-b', range);
  assert.equal(reports.analytics(w, range).summary.views, 300);
});
test('old grants request permission, monetary reports require separate consent', async () => {
  const { reports } = await setup({ scopes: [] });
  const value = await reports.sync(w, 'real-a', range);
  assert.equal(value.sections.daily, 'permission_required');
  assert.equal(value.sections.revenue, 'permission_required');
  assert.equal(
    reports.revenue(w, new URLSearchParams({ ...Object.fromEntries(range), channelId: 'real-a' })).amount,
    null,
  );
});
test('finance is estimated USD, not a payout; no-data is not invented zero', async () => {
  let f = await setup({ scopes: [analytics, money] });
  await f.reports.sync(w, 'real-a', range);
  let r = f.reports.revenue(w, new URLSearchParams({ ...Object.fromEntries(range), channelId: 'real-a' }));
  assert.equal(r.amount, 3.25);
  assert.equal(r.currency, 'USD');
  assert.equal(r.nature, 'estimated');
  assert.deepEqual(r.payouts, []);
  f = await setup({ scopes: [analytics, money], noData: true });
  await f.reports.sync(w, 'real-a', range);
  r = f.reports.revenue(w, new URLSearchParams({ ...Object.fromEntries(range), channelId: 'real-a' }));
  assert.equal(r.status, 'no_data');
  assert.equal(r.amount, null);
  assert.equal(
    f.reports.analytics(w, new URLSearchParams({ ...Object.fromEntries(range), channelId: 'real-a' })).summary.views,
    null,
  );
});
test('optional report failures preserve successful core metrics', async () => {
  const f = await setup({ failCountry: true });
  await f.reports.sync(w, 'real-a', range);
  const r = f.reports.analytics(w, new URLSearchParams({ ...Object.fromEntries(range), channelId: 'real-a' }));
  assert.equal(r.summary.views, 150);
  assert.equal(r.audience.countries.status, 'partial');
  assert.equal(r.audience.countries.coverage[0].reason, 'Restricted report');
  assert.equal(r.audience.devices.items.length, 1);
});
test('comments sync upserts real plain-text threads and live replies are blocked', async t => {
  const f = await setup();
  await f.reports.syncComments(w, 'real-a');
  await f.reports.syncComments(w, 'real-a');
  assert.equal(f.repository.read().comments.filter(c => c.workspaceId === w).length, 1);
  assert.equal(f.repository.read().comments.find(c => c.workspaceId === w).text, 'Real comment');
  const app = createApp({ repository: f.repository, youtube: f.youtube });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  t.after(
    () =>
      new Promise(r => {
        app.close(r);
        app.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${app.address().port}/api/v1/workspaces/${w}`;
  const r = await fetch(base + '/community/comments/yt-comment-comment-1/replies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'No publish' }),
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, 'READ_ONLY_YOUTUBE');
  const res = await fetch(base + '/channels/real-a/reports/sync?' + range, { method: 'POST' });
  assert.equal(res.status, 200);
  const a = await fetch(base + '/analytics?' + range + '&channelId=real-a');
  assert.equal((await a.json()).data.summary.views, 150);
});
test('invalid intervals are rejected before provider calls', async () => {
  const f = await setup();
  await assert.rejects(f.reports.sync(w, 'real-a', new URLSearchParams({ from: '2026-02-30' })), {
    code: 'INVALID_DATE',
  });
  assert.throws(() => f.reports.analytics(w, new URLSearchParams({ from: '2026-03-01', to: '2026-01-01' })), {
    code: 'INVALID_RANGE',
  });
});

test('comments need the separate Google scope before querying the provider', async () => {
  const f = await setup({ scopes: [analytics] });
  await assert.rejects(f.reports.syncComments(w, 'real-a'), { code: 'YOUTUBE_COMMENTS_PERMISSION_REQUIRED' });
  assert.equal(f.repository.read().comments.filter(c => c.workspaceId === w).length, 0);
});
