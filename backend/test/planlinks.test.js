import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentGame, deliversDeal, linkPlans, localDateTime, planRecords, similarTitles } from '../src/planlinks.js';

const w = 'w';
const channels = [
  { id: 'tw', workspaceId: w, platform: 'Twitch', watchUrl: 'https://twitch.tv/x' },
  { id: 'kk', workspaceId: w, platform: 'Kick', watchUrl: 'https://kick.com/x' },
  { id: 'yt', workspaceId: w, platform: 'YouTube' },
];
const content = (id, channelId, title, publishedAt, format = 'VOD', extra = {}) => ({
  id,
  workspaceId: w,
  channelId,
  title,
  format,
  publishedAt,
  date: publishedAt.slice(0, 10),
  duration: '3h0m0s',
  ...extra,
});
const plan = (id, extra) => ({
  id,
  workspaceId: w,
  channelId: 'tw',
  format: 'Live',
  stage: 'Ideia',
  createdAt: '2026-10-01T00:00:00Z',
  ...extra,
});

test('local day and time follow São Paulo (a 01:00 UTC stream belongs to the previous evening)', () => {
  assert.deepEqual(localDateTime('2026-10-29T01:30:00Z'), { date: '2026-10-28', time: '22:30' });
});

test('similar titles: same words in another case, accents or order count; unrelated titles do not', () => {
  assert.ok(similarTitles('Review do Novo Jogo', 'REVIEW do novo jogo!!'));
  assert.ok(similarTitles('Guia completo de builds', 'Builds: guia completo para iniciantes'));
  assert.ok(!similarTitles('Guia completo de builds', 'Live de sexta com a comunidade'));
});

test('a past live is linked to the VOD of the same day whatever its title; a deal plan picks its own content first', () => {
  const state = {
    channels,
    contents: [
      content('vod-regular', 'tw', 'AION 2 | DROPS ON | !sorteio', '2026-10-28T22:00:00Z'),
      content('vod-deal', 'tw', 'AION 2 | #publi Marca X', '2026-10-28T18:00:00Z'),
      content('clip', 'tw', 'clip', '2026-10-28T23:00:00Z', 'Clip'),
    ],
    financial: [
      {
        id: 'deal',
        workspaceId: w,
        type: 'deal',
        title: 'Marca X',
        date: '2026-10-27',
        endDate: '2026-10-29',
        stage: 'Confirmado',
        keywords: ['marca x'],
      },
    ],
    plans: [plan('regular', { date: '2026-10-28' }), plan('sponsored', { date: '2026-10-28', dealId: 'deal' })],
  };
  const links = linkPlans(state, w, '2026-11-17');
  assert.equal(links.get('sponsored').content.id, 'vod-deal');
  assert.equal(links.get('sponsored').linked, 'deal');
  assert.equal(links.get('regular').content.id, 'vod-regular');
  // A manual pick always wins.
  state.plans[0].contentId = 'vod-deal';
  const manual = linkPlans(state, w, '2026-11-17');
  assert.equal(manual.get('regular').linked, 'manual');
  assert.equal(manual.get('sponsored').content.id, 'vod-regular', 'the deal plan falls back to the day rule');
});

test('future plans are not linked before their day unless ready; videos need a similar title within 2 days', () => {
  const state = {
    channels,
    contents: [content('up', 'yt', 'Review do novo jogo', '2026-11-19T15:00:00Z', 'Vídeo')],
    plans: [
      plan('future', { channelId: 'yt', format: 'Vídeo', title: 'Review do novo jogo', date: '2026-11-20' }),
      plan('other', { channelId: 'yt', format: 'Vídeo', title: 'Algo diferente', date: '2026-11-19' }),
    ],
  };
  assert.equal(linkPlans(state, w, '2026-11-17').size, 0);
  state.plans[0].stage = 'Pronto';
  const links = linkPlans(state, w, '2026-11-17');
  assert.equal(links.get('future').content.id, 'up');
  assert.equal(links.has('other'), false);
});

test('deal window and keywords: one-day deal only on its day; title, tags and the streamed game count', () => {
  const state = {
    channels,
    streamSnapshots: [
      { workspaceId: w, channelId: 'tw', isLive: true, game: 'Aion 2', observedAt: '2026-11-03T22:30:00Z' },
      { workspaceId: w, channelId: 'tw', isLive: true, game: 'Aion 2', observedAt: '2026-11-03T23:00:00Z' },
    ],
  };
  const vod = content('v', 'tw', 'Live de terça', '2026-11-03T22:00:00Z');
  assert.equal(contentGame(state, vod), 'Aion 2');
  const oneDay = { date: '2026-11-03', endDate: null, keywords: ['aion 2'] };
  assert.ok(deliversDeal(state, oneDay, vod));
  assert.ok(!deliversDeal(state, { ...oneDay, date: '2026-11-04' }, vod), 'outside the 1-day window');
  assert.ok(deliversDeal(state, { date: '2026-11-01', endDate: '2026-11-07', keywords: ['terça'] }, vod));
  assert.ok(!deliversDeal(state, { ...oneDay, keywords: [] }, vod), 'no keywords: never matched');
});

test('calendar records: unclaimed content (no clips), Kick lives from the sync, and the deal they deliver', () => {
  const state = {
    channels,
    contents: [
      content('vod', 'tw', 'AION 2 com Marca X', '2026-11-03T22:00:00Z'),
      content('clip', 'tw', 'clip', '2026-11-03T23:00:00Z', 'Clip'),
      content('claimed', 'yt', 'Vídeo planejado', '2026-11-04T15:00:00Z', 'Vídeo'),
    ],
    streamSnapshots: [
      {
        workspaceId: w,
        channelId: 'kk',
        isLive: true,
        title: 'Live na Kick',
        game: 'Aion 2',
        startedAt: '2026-11-05T21:00:00Z',
        observedAt: '2026-11-05T21:30:00Z',
      },
      // Twitch live with a VOD: no extra record.
      {
        workspaceId: w,
        channelId: 'tw',
        isLive: true,
        title: 'x',
        startedAt: '2026-11-03T22:05:00Z',
        observedAt: '2026-11-03T22:30:00Z',
      },
    ],
    financial: [
      {
        id: 'd',
        workspaceId: w,
        type: 'deal',
        title: 'Marca X',
        date: '2026-11-01',
        endDate: '2026-11-07',
        stage: 'Confirmado',
        keywords: ['Marca X'],
      },
    ],
    plans: [],
  };
  const links = new Map([['p', { content: state.contents[2], linked: 'manual' }]]);
  const records = planRecords(state, w, {
    from: '2026-11-01',
    to: '2026-11-30',
    channelIds: ['tw', 'kk', 'yt'],
    links,
  });
  assert.deepEqual(
    records.map(r => [r.id, r.kind, r.date]),
    [
      ['vod', 'content', '2026-11-03'],
      ['live-kk-2026-11-05T21:00:00Z', 'live', '2026-11-05'],
    ],
  );
  assert.deepEqual(records[0].deal, { id: 'd', title: 'Marca X' });
  assert.equal(records[1].game, 'Aion 2');
  assert.equal(records[1].time, '18:00');
});
