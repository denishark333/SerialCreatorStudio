import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../src/repository.js';
import { createVault } from '../src/vault.js';
import { createStreams } from '../src/streams.js';
import { createEventSub } from '../src/eventsub.js';
import { createLiveStats } from '../src/livestats.js';
import { LIVE_WORKSPACE } from '../src/youtube.js';

const W = LIVE_WORKSPACE;
const json = body => ({ ok: true, status: 200, json: async () => body });
const ALL = ['moderator:read:followers', 'channel:read:subscriptions', 'bits:read', 'user:read:chat'];

async function seeded(t, scopes = ALL) {
  const dir = await mkdtemp(join(tmpdir(), 'serial-live-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repository = await createRepository();
  const vault = await createVault(join(dir, 'key'));
  await repository.update(s => {
    s.channels.push({
      id: 'tw',
      workspaceId: W,
      platform: 'Twitch',
      name: 'Canal',
      externalId: '12',
      connectionId: 'grant-1',
      dataSource: 'twitch',
    });
    s.connections.push({
      id: 'grant-1',
      workspaceId: W,
      platform: 'Twitch',
      status: 'connected',
      channelIds: ['tw'],
      scopes,
      encryptedTokens: vault.seal({ access_token: 'ok', refresh_token: 'ok', expiresAt: Date.now() + 3600000 }),
    });
  });
  return { repository, vault };
}

test('Twitch sync: subscribers by tier (gifts in their tier, broadcaster excluded), month bits and followers history', async t => {
  const { repository, vault } = await seeded(t);
  const pages = {
    '': {
      total: 5,
      data: [
        { user_id: '12', tier: '3000', is_gift: false },
        { user_id: 'a', tier: '1000', is_gift: false },
        { user_id: 'b', tier: '1000', is_gift: true },
      ],
      pagination: { cursor: 'next' },
    },
    next: { total: 5, data: [{ user_id: 'c', tier: '2000', is_gift: false }], pagination: {} },
  };
  const streams = createStreams({
    repository,
    vault,
    configs: { Twitch: { clientId: 'twitch-id', clientSecret: 'secret' } },
    fetcher: async url => {
      const u = new URL(url),
        path = u.pathname.replace('/helix/', '');
      if (u.pathname.endsWith('/validate')) return json({ client_id: 'twitch-id', user_id: '12' });
      if (path === 'users')
        return json({ data: [{ id: '12', display_name: 'Canal', login: 'canal', profile_image_url: '' }] });
      if (path === 'streams') return json({ data: [] });
      if (path === 'channels/followers') return json({ total: 250 });
      if (path === 'subscriptions')
        return json(u.searchParams.get('first') === '1' ? { total: 5 } : pages[u.searchParams.get('after') ?? '']);
      if (path === 'bits/leaderboard') {
        assert.equal(u.searchParams.get('period'), 'month');
        return json({ data: [{ score: 1200 }, { score: 300 }] });
      }
      return json({ data: [], pagination: {} });
    },
  });
  await streams.sync(W, 'tw');
  const channel = repository.read().channels[0];
  assert.deepEqual(
    { ...channel.twitchRevenue.subs },
    { tier1: 2, tier2: 1, tier3: 0, gifted: 1, total: 5, complete: true },
  );
  assert.equal(channel.twitchRevenue.bits.total, 1500);
  assert.equal(channel.bitsByMonth[channel.twitchRevenue.bits.month], 1500);
  assert.equal(repository.read().streamSnapshots.at(-1).followers, 250);
});

test('Twitch sync: without bits:read the month bits are skipped, never failing the sync', async t => {
  const { repository, vault } = await seeded(t, ['moderator:read:followers', 'channel:read:subscriptions']);
  const calls = [];
  const streams = createStreams({
    repository,
    vault,
    configs: { Twitch: { clientId: 'twitch-id', clientSecret: 'secret' } },
    fetcher: async url => {
      const u = new URL(url);
      calls.push(u.pathname);
      if (u.pathname.endsWith('/validate')) return json({ client_id: 'twitch-id', user_id: '12' });
      if (u.pathname.endsWith('/users')) return json({ data: [{ id: '12', display_name: 'Canal', login: 'canal' }] });
      return json({ data: [], total: 0, pagination: {} });
    },
  });
  await streams.sync(W, 'tw');
  assert.ok(!calls.some(p => p.includes('bits')));
  assert.equal(repository.read().channels[0].twitchRevenue.bits, null);
  const revenue = createLiveStats({ repository }).revenue(W, new URLSearchParams());
  assert.deepEqual(revenue.items[0].missing, ['bits', 'chat']);
});

class FakeSocket {
  static all = [];
  constructor(url) {
    this.url = url;
    this.closed = false;
    FakeSocket.all.push(this);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
  emit(type, payload = {}, extra = {}) {
    this.onmessage({
      data: JSON.stringify({
        metadata: { message_id: Math.random().toString(36).slice(2), message_type: type, ...extra },
        payload,
      }),
    });
  }
  notify(subscriptionType, event, at = new Date().toISOString()) {
    this.emit('notification', { subscription: { type: subscriptionType }, event }, { message_timestamp: at });
  }
}

test('EventSub: subscribes per granted scope, stores raids, subs, gifts, bits and unique chatters of the live', async t => {
  const { repository } = await seeded(t);
  FakeSocket.all = [];
  const types = [];
  const eventsub = createEventSub({
    repository,
    streams: { configured: () => true, helix: async (_c, _p, { body }) => types.push(body.type) },
    WebSocketImpl: FakeSocket,
    logger: { error() {} },
  });
  eventsub.start();
  t.after(() => eventsub.stop());
  const ws = FakeSocket.all[0];
  ws.emit('session_welcome', { session: { id: 'session-1', keepalive_timeout_seconds: 10 } });
  await new Promise(r => setImmediate(r));
  assert.equal(types.length, 9);
  assert.ok(types.includes('channel.chat.message') && types.includes('channel.cheer'));

  const startedAt = new Date(Date.now() - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  ws.notify('stream.online', { started_at: startedAt });
  ws.notify('channel.raid', { from_broadcaster_user_name: 'Amiga', from_broadcaster_user_login: 'amiga', viewers: 42 });
  ws.notify('channel.subscribe', { tier: '1000', is_gift: false });
  ws.notify('channel.subscribe', { tier: '1000', is_gift: true }); // counted by the gift event
  ws.notify('channel.subscription.gift', { tier: '1000', total: 5 });
  ws.notify('channel.cheer', { bits: 300 });
  for (const user of ['a', 'b', 'a', '12']) ws.notify('channel.chat.message', { chatter_user_id: user });
  ws.notify('channel.chat.notification', { notice_type: 'sub', sub: { sub_tier: '1000', is_prime: true } });
  ws.notify('channel.chat.notification', { notice_type: 'resub', resub: { sub_tier: '1000', is_gift: true } });
  ws.notify('channel.chat.notification', { notice_type: 'raid', raid: {} });
  await eventsub.flush();

  const state = repository.read();
  assert.deepEqual(
    state.streamEvents.map(e => [e.type, e.amount]),
    [
      ['raid', 42],
      ['sub', 1],
      ['gift', 5],
      ['cheer', 300],
      ['notice', 1],
    ],
  );
  assert.equal(state.streamEvents.at(-1).prime, true);
  const chat = state.chatSessions[0];
  assert.equal(chat.messages, 3, 'the broadcaster’s own messages are not counted');
  assert.equal(chat.chatters, 2);
  assert.ok(
    chat.hashes.every(h => !['a', 'b'].includes(h)),
    'only hashes are kept',
  );

  // The live as the sync saw it: events and chat land on that broadcast.
  await repository.update(s => {
    s.streamSnapshots = [
      {
        workspaceId: W,
        channelId: 'tw',
        observedAt: new Date(Date.parse(startedAt) - 600000).toISOString(),
        isLive: false,
        followers: 240,
      },
      {
        workspaceId: W,
        channelId: 'tw',
        observedAt: new Date(Date.parse(startedAt) + 600000).toISOString(),
        isLive: true,
        startedAt,
        viewers: 20,
        game: 'Aion 2',
        title: 'Live',
        followers: 241,
      },
      {
        workspaceId: W,
        channelId: 'tw',
        observedAt: new Date(Date.parse(startedAt) + 3000000).toISOString(),
        isLive: true,
        startedAt,
        viewers: 40,
        game: 'Aion 2',
        title: 'Live',
        followers: 248,
      },
    ];
  });
  const [session] = createLiveStats({ repository }).sessions(W, new URLSearchParams());
  assert.equal(session.avgViewers, 30);
  assert.equal(session.peakViewers, 40);
  assert.equal(session.minutes, 50);
  assert.equal(session.minutesWatched, 1500);
  assert.equal(session.followersGained, 8);
  assert.deepEqual([session.subs, session.gifts, session.bits], [1, 5, 300]);
  assert.equal(session.raids[0].from, 'Amiga');
  assert.deepEqual(session.chat, { messages: 3, chatters: 2 });

  // The live ends: counts stay, chatter hashes are dropped; off-air chat is ignored.
  ws.notify('stream.offline', {});
  await eventsub.flush();
  ws.notify('channel.chat.message', { chatter_user_id: 'c' });
  await eventsub.flush();
  const ended = repository.read().chatSessions[0];
  assert.equal(ended.hashes, undefined);
  assert.equal(ended.chatters, 2);
  assert.ok(ended.endedAt);
});

test('EventSub: a reconnect message moves to the new socket without resubscribing; disconnecting closes it', async t => {
  const { repository } = await seeded(t);
  FakeSocket.all = [];
  let subscriptions = 0;
  const eventsub = createEventSub({
    repository,
    streams: { configured: () => true, helix: async () => subscriptions++ },
    WebSocketImpl: FakeSocket,
    logger: { error() {} },
  });
  eventsub.start();
  t.after(() => eventsub.stop());
  const first = FakeSocket.all[0];
  first.emit('session_welcome', { session: { id: 's1', keepalive_timeout_seconds: 10 } });
  await new Promise(r => setImmediate(r));
  const created = subscriptions;
  first.emit('session_reconnect', { session: { reconnect_url: 'wss://reconnect.example/ws' } });
  const second = FakeSocket.all[1];
  assert.equal(second.url, 'wss://reconnect.example/ws');
  second.emit('session_welcome', { session: { id: 's1', keepalive_timeout_seconds: 10 } });
  await new Promise(r => setImmediate(r));
  assert.equal(first.closed, true);
  assert.equal(subscriptions, created, 'subscriptions carry over to the reconnect URL');
  assert.deepEqual(eventsub.connected(), ['grant-1']);
  // Disconnecting the channel closes its socket.
  await repository.update(s => {
    s.connections = [];
  });
  eventsub.reconcile();
  assert.equal(second.closed, true);
  assert.deepEqual(eventsub.connected(), []);
});

test('revenue estimate: subs × net value per tier plus bits; settings are validated', async t => {
  const { repository } = await seeded(t);
  const stats = createLiveStats({ repository });
  const month = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
  await repository.update(s => {
    s.channels[0].twitchRevenue = {
      subs: { tier1: 10, tier2: 1, tier3: 0, gifted: 3, total: 11, complete: true },
      bits: { month, total: 1500 },
      observedAt: new Date().toISOString(),
    };
  });
  let item = stats.revenue(W, new URLSearchParams()).items[0];
  assert.equal(item.estimate.subs, null, 'no estimate for subs until the values are set');
  assert.equal(item.estimate.bits, 15);
  assert.equal(item.estimate.total, 15);
  await stats.setRevenueSettings(W, 'tw', { tier1: 1.2, tier2: 2.5, tier3: 6, prime: 0.8 });
  item = stats.revenue(W, new URLSearchParams()).items[0];
  assert.equal(item.estimate.subs, 14.5, 'no announcements seen: every Tier 1 is valued as paid');
  assert.equal(item.estimate.total, 29.5);
  // Chat announcements: 2 of 5 Tier 1 subs were Prime → 4 of the 10 active Tier 1 are valued as Prime.
  await repository.update(s => {
    s.streamEvents = [true, true, false, false, false].map((prime, i) => ({
      id: 'n' + i,
      workspaceId: W,
      channelId: 'tw',
      type: 'notice',
      tier: 1,
      prime,
      amount: 1,
      at: new Date().toISOString(),
    }));
  });
  item = stats.revenue(W, new URLSearchParams()).items[0];
  assert.deepEqual(item.prime, { estimated: 4, share: 0.4, samples: 5 });
  assert.equal(item.estimate.subs, 12.9); // 6 × 1,20 + 4 × 0,80 + 1 × 2,50
  // Without a Prime value of their own: the Brazilian fixed rate (US$ 0.75).
  await stats.setRevenueSettings(W, 'tw', { tier1: 1.2, tier2: 2.5, tier3: 6, prime: null });
  assert.equal(stats.revenue(W, new URLSearchParams()).items[0].estimate.subs, 12.7);
  await assert.rejects(stats.setRevenueSettings(W, 'tw', { tier1: -1 }), e => e.code === 'INVALID_FIELD');
  await assert.rejects(stats.setRevenueSettings(W, 'tw', { ads: 1 }), e => e.code === 'UNKNOWN_FIELDS');
});

test('analytics: daily rows, totals weighted by minutes, followers per day, games and raiders', async t => {
  const { repository } = await seeded(t);
  const snap = (observedAt, extra) => ({ workspaceId: W, channelId: 'tw', observedAt, ...extra });
  await repository.update(s => {
    s.streamSnapshots = [
      snap('2026-11-01T12:00:00Z', { isLive: false, followers: 100 }),
      // Live A, 2026-11-02 18:00–20:00 local (21:00–23:00 UTC): 10 then 30 viewers.
      snap('2026-11-02T21:30:00Z', {
        isLive: true,
        startedAt: '2026-11-02T21:00:00Z',
        viewers: 10,
        game: 'Aion 2',
        followers: 104,
      }),
      snap('2026-11-02T23:00:00Z', {
        isLive: true,
        startedAt: '2026-11-02T21:00:00Z',
        viewers: 30,
        game: 'Aion 2',
        followers: 110,
      }),
      // Live B, 2026-11-03, 1 hour at 50 viewers.
      snap('2026-11-03T21:00:00Z', {
        isLive: true,
        startedAt: '2026-11-03T20:00:00Z',
        viewers: 50,
        game: 'Just Chatting',
        followers: 115,
      }),
    ];
    s.streamEvents = [
      {
        id: 'r1',
        workspaceId: W,
        channelId: 'tw',
        type: 'raid',
        from: 'Amiga',
        amount: 40,
        at: '2026-11-02T22:00:00Z',
      },
      {
        id: 'r2',
        workspaceId: W,
        channelId: 'tw',
        type: 'raid',
        from: 'Amiga',
        amount: 10,
        at: '2026-11-03T20:30:00Z',
      },
      { id: 'g1', workspaceId: W, channelId: 'tw', type: 'gift', amount: 5, at: '2026-11-02T22:10:00Z' },
      { id: 'c1', workspaceId: W, channelId: 'tw', type: 'cheer', amount: 300, at: '2026-11-03T20:40:00Z' },
    ];
  });
  const a = createLiveStats({ repository }).analytics(W, new URLSearchParams({ from: '2026-11-01', to: '2026-11-04' }));
  assert.equal(a.days.length, 4);
  const [d1, d2, d3, d4] = a.days;
  assert.deepEqual([d1.lives, d1.followers], [0, null], 'the first known count is only the base');
  assert.deepEqual([d2.lives, d2.minutes, d2.avgViewers, d2.followers, d2.subs], [1, 120, 20, 10, 5]);
  assert.deepEqual([d3.minutes, d3.avgViewers, d3.followers, d3.bits], [60, 50, 5, 300]);
  assert.equal(d4.lives, 0);
  // (20 × 120 + 50 × 60) / 180 = 30
  assert.equal(a.totals.avgViewers, 30);
  assert.deepEqual([a.totals.followers, a.totals.raids, a.totals.raidViewers, a.totals.peakViewers], [15, 2, 50, 50]);
  assert.deepEqual(
    a.games.map(g => [g.game, g.minutes]),
    [
      ['Aion 2', 120],
      ['Just Chatting', 60],
    ],
  );
  assert.deepEqual(a.raiders[0], { name: 'Amiga', login: null, raids: 2, viewers: 50 });
  assert.equal(a.dataSince, '2026-11-01');
});
