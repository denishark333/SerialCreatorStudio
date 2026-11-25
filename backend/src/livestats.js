import { fail, dateOnly, objectBody } from './errors.js';
import { localDateTime } from './planlinks.js';

const MIN = 60000;
/** Scopes each live feature needs; a connection made before them must be reconnected to enable it. */
export const LIVE_SCOPES = { bits: 'bits:read', chat: 'user:read:chat' };
/** US$ the creator receives per bit (fixed by Twitch). */
export const BIT_VALUE = 0.01;
/**
 * US$ paid per Prime sub from a Brazilian viewer (fixed rate, Twitch's Prime revenue guide, updated 2025-10-10).
 * Used while the creator has not set their own Prime value.
 */
export const PRIME_DEFAULT = 0.75;
const TIERS = ['tier1', 'tier2', 'tier3'];
/** Net values the creator sets: one per paid tier, plus Prime Gaming (a fixed amount by viewer country). */
const VALUES = [...TIERS, 'prime'];

const mode = values => {
  const count = new Map();
  for (const v of values) if (v) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const round = (n, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Live statistics of Twitch/Kick channels, computed at read time from what the sync and EventSub stored:
 * - `sessions`: one row per broadcast (viewers sampled by the sync, followers gained, raids, subs, bits, chat);
 * - `revenue`: this month's Twitch estimate (active subscribers × the net value per tier the creator sets, plus
 *   bits). Ads and Prime payouts are not estimated: their value never reaches the API.
 */
export function createLiveStats({ repository }) {
  function scope(w, params) {
    const s = repository.snapshot();
    if (!s.workspaces.some(v => v.id === w)) fail(404, 'WORKSPACE_NOT_FOUND', 'Estúdio não encontrado.');
    const ids = params.getAll('channelId');
    const channels = s.channels.filter(
      c => c.workspaceId === w && ['Twitch', 'Kick'].includes(c.platform) && (!ids.length || ids.includes(c.id)),
    );
    for (const id of ids)
      if (!s.channels.some(c => c.workspaceId === w && c.id === id))
        fail(404, 'CHANNEL_NOT_FOUND', 'Canal não pertence ao estúdio.');
    return { s, channels };
  }
  const grantOf = (s, channel) => s.connections.find(c => c.id === channel.connectionId);
  const missing = (s, channel) => {
    const scopes = new Set(grantOf(s, channel)?.scopes ?? []);
    return channel.platform !== 'Twitch'
      ? []
      : Object.entries(LIVE_SCOPES)
          .filter(([, scope]) => !scopes.has(scope))
          .map(([feature]) => feature);
  };

  /** Every broadcast of the period (newest first), with the snapshots and channels it was built from. */
  function collect(w, params) {
    const { s, channels } = scope(w, params);
    const today = localDateTime(new Date().toISOString()).date;
    const to = dateOnly(params.get('to') ?? today, 'to');
    const fromDefault = new Date(Date.parse(to + 'T12:00:00Z') - 29 * 86400000).toISOString().slice(0, 10);
    const from = dateOnly(params.get('from') ?? fromDefault, 'from');
    if (from > to) fail(400, 'INVALID_RANGE', 'from deve ser anterior ou igual a to.');
    const byId = new Map(channels.map(c => [c.id, c]));
    const snapshots = (s.streamSnapshots ?? [])
      .filter(v => v.workspaceId === w && byId.has(v.channelId))
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const groups = new Map();
    for (const v of snapshots) {
      if (!v.isLive) continue;
      const started = v.startedAt ?? v.observedAt,
        key = v.channelId + '|' + started;
      if (!groups.has(key)) groups.set(key, { channelId: v.channelId, startedAt: started, samples: [] });
      groups.get(key).samples.push(v);
    }
    const events = (s.streamEvents ?? []).filter(e => e.workspaceId === w && byId.has(e.channelId));
    const chats = (s.chatSessions ?? []).filter(c => c.workspaceId === w && byId.has(c.channelId));
    const rows = [];
    for (const g of groups.values()) {
      const at = localDateTime(g.startedAt);
      if (!at || at.date < from || at.date > to) continue;
      const channel = byId.get(g.channelId),
        start = Date.parse(g.startedAt),
        last = g.samples.at(-1),
        end = Date.parse(last.observedAt);
      const viewers = g.samples.map(v => v.viewers).filter(v => Number.isFinite(v));
      const minutes = Math.max(0, Math.round((end - start) / MIN));
      const avg = viewers.length ? viewers.reduce((n, v) => n + v, 0) / viewers.length : null;
      // Followers: last count seen before the live (or its first sample) → first count after it (or its last).
      const own = snapshots.filter(v => v.channelId === g.channelId && Number.isFinite(v.followers));
      const before = own.filter(v => Date.parse(v.observedAt) <= start).at(-1) ?? own.find(v => g.samples.includes(v));
      const after =
        own.find(v => Date.parse(v.observedAt) > end && Date.parse(v.observedAt) - end <= 60 * MIN) ??
        [...own].reverse().find(v => g.samples.includes(v));
      const window = e => {
        const t = Date.parse(e.at);
        return e.channelId === g.channelId && t >= start - 5 * MIN && t <= end + 35 * MIN;
      };
      const mine = events.filter(window);
      const sum = type => mine.filter(e => e.type === type).reduce((n, e) => n + (e.amount ?? 0), 0);
      const chat = chats.find(c => c.channelId === g.channelId && Math.abs(Date.parse(c.startedAt) - start) < 15 * MIN);
      rows.push({
        id: 'session-' + g.channelId + '-' + g.startedAt,
        channelId: g.channelId,
        platform: channel.platform,
        title: last.title || null,
        thumbnailUrl: [...g.samples].reverse().find(v => v.thumbnailUrl)?.thumbnailUrl ?? null,
        game: mode(g.samples.map(v => v.game)),
        startedAt: g.startedAt,
        date: at.date,
        time: at.time,
        lastSeenAt: last.observedAt,
        live: Boolean(byId.get(g.channelId).live?.isLive && byId.get(g.channelId).live.startedAt === g.startedAt),
        minutes,
        samples: g.samples.length,
        avgViewers: avg === null ? null : Math.round(avg),
        peakViewers: viewers.length ? Math.max(...viewers) : null,
        minutesWatched: avg === null ? null : Math.round(avg * minutes),
        followersGained: before && after && after !== before ? after.followers - before.followers : null,
        subs: sum('sub'),
        resubs: sum('resub'),
        gifts: sum('gift'),
        bits: sum('cheer'),
        raids: mine
          .filter(e => e.type === 'raid')
          .map(e => ({ from: e.from, fromLogin: e.fromLogin ?? null, viewers: e.amount, at: e.at })),
        chat: chat ? { messages: chat.messages, chatters: chat.chatters } : null,
        tracking: {
          events: channel.platform === 'Twitch',
          chat: channel.platform === 'Twitch' && !missing(s, channel).includes('chat'),
        },
      });
    }
    return {
      rows: rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      state: s,
      snapshots,
      channels,
      from,
      to,
    };
  }

  const sessions = (w, params) => collect(w, params).rows.slice(0, 60);

  /**
   * Analytics of the period for Twitch/Kick, from the stored broadcasts: totals, one row per day (lives, minutes
   * streamed, average/peak viewers, estimated minutes watched, followers gained, subs, bits, chat), and the
   * breakdown by game and by raiding channel. Followers come from the counts saved by each sync.
   */
  function analytics(w, params) {
    const { rows, state, snapshots, channels, from, to } = collect(w, params);
    const weighted = list => {
      const minutes = list.reduce((n, r) => n + (r.avgViewers === null ? 0 : r.minutes), 0);
      return minutes ? Math.round(list.reduce((n, r) => n + (r.avgViewers ?? 0) * r.minutes, 0) / minutes) : null;
    };
    const sumOf = (list, key) => list.reduce((n, r) => n + (r[key] ?? 0), 0);
    // Followers gained per day: per channel, last count of each day minus the last count before it.
    const followersByDay = new Map();
    for (const channel of channels) {
      let previous = null;
      const lastOfDay = new Map();
      for (const v of snapshots)
        if (v.channelId === channel.id && Number.isFinite(v.followers))
          lastOfDay.set(localDateTime(v.observedAt).date, v.followers);
      for (const [day, value] of [...lastOfDay].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (previous !== null && day >= from && day <= to)
          followersByDay.set(day, (followersByDay.get(day) ?? 0) + value - previous);
        previous = value;
      }
    }
    const days = [];
    for (let t = Date.parse(from + 'T12:00:00Z'); t <= Date.parse(to + 'T12:00:00Z'); t += 86400000) {
      const date = new Date(t).toISOString().slice(0, 10),
        mine = rows.filter(r => r.date === date);
      days.push({
        date,
        lives: mine.length,
        minutes: sumOf(mine, 'minutes'),
        avgViewers: weighted(mine),
        peakViewers: mine.length ? Math.max(0, ...mine.map(r => r.peakViewers ?? 0)) : null,
        minutesWatched: sumOf(mine, 'minutesWatched'),
        followers: followersByDay.has(date) ? followersByDay.get(date) : null,
        subs: mine.reduce((n, r) => n + r.subs + r.resubs + r.gifts, 0),
        bits: sumOf(mine, 'bits'),
        chatters: mine.reduce((n, r) => n + (r.chat?.chatters ?? 0), 0),
        raids: mine.reduce((n, r) => n + r.raids.length, 0),
      });
    }
    const group = (key, list) => {
      const map = new Map();
      for (const r of list) {
        const k = key(r);
        if (k) map.set(k, [...(map.get(k) ?? []), r]);
      }
      return map;
    };
    const games = [...group(r => r.game, rows)]
      .map(([game, list]) => ({
        game,
        lives: list.length,
        minutes: sumOf(list, 'minutes'),
        avgViewers: weighted(list),
      }))
      .sort((a, b) => b.minutes - a.minutes);
    const raids = rows.flatMap(r => r.raids);
    const raiders = [...group(r => r.from, raids)]
      .map(([name, list]) => ({ name, login: list[0].fromLogin, raids: list.length, viewers: sumOf(list, 'viewers') }))
      .sort((a, b) => b.viewers - a.viewers);
    const firstData = snapshots[0]?.observedAt ?? null;
    const followerDays = [...followersByDay.values()];
    return {
      from,
      to,
      dataSince: firstData ? localDateTime(firstData).date : null,
      totals: {
        lives: rows.length,
        minutes: sumOf(rows, 'minutes'),
        avgViewers: weighted(rows),
        peakViewers: rows.length ? Math.max(0, ...rows.map(r => r.peakViewers ?? 0)) : null,
        minutesWatched: sumOf(rows, 'minutesWatched'),
        followers: followerDays.length ? followerDays.reduce((n, v) => n + v, 0) : null,
        subs: days.reduce((n, d) => n + d.subs, 0),
        bits: sumOf(rows, 'bits'),
        chatters: days.reduce((n, d) => n + d.chatters, 0),
        raids: raids.length,
        raidViewers: sumOf(raids, 'viewers'),
      },
      days,
      games,
      raiders,
      sessions: rows.slice(0, 100),
      // Per channel: what is collected, since when, and what a reconnection would enable.
      coverage: channels.map(c => {
        const own = snapshots.filter(v => v.channelId === c.id),
          gaps = missing(state, c);
        return {
          channelId: c.id,
          name: c.name,
          status: own.length ? 'available' : 'not_synced',
          reason: !own.length
            ? 'Aguardando a primeira coleta.'
            : c.platform === 'Kick'
              ? 'Coletas a cada 30 min (espectadores, seguidores e jogo). A Kick não envia subs, raids nem chat pela API.'
              : gaps.length
                ? `Reconecte a Twitch para registrar ${gaps.map(f => (f === 'bits' ? 'bits' : 'o chat')).join(' e ')}.`
                : 'Coletas a cada 30 min e eventos em tempo real (subs, bits, raids e chat).',
          fetchedAt: c.lastSyncedAt ?? null,
          since: own[0] ? localDateTime(own[0].observedAt).date : null,
        };
      }),
      tracking: {
        events: channels.some(c => c.platform === 'Twitch'),
        chat: channels.some(c => c.platform === 'Twitch' && !missing(state, c).includes('chat')),
      },
    };
  }

  function revenue(w, params) {
    const { s, channels } = scope(w, params);
    const month = localDateTime(new Date().toISOString()).date.slice(0, 7);
    const items = channels
      .filter(c => c.platform === 'Twitch')
      .map(c => {
        const signals = c.twitchRevenue ?? null,
          values = c.revenueSettings ?? null,
          subs = signals?.subs ?? null;
        const bits = signals?.bits?.month === month ? signals.bits.total : null;
        // Prime subs count as Tier 1 in the API. Their share comes from the sub announcements seen in chat over the
        // last 30 days (each says whether it was Prime) and is applied to the active Tier 1 subscribers.
        const since = Date.now() - 30 * 86400000;
        const notices = (s.streamEvents ?? []).filter(
          e =>
            e.workspaceId === w &&
            e.channelId === c.id &&
            e.type === 'notice' &&
            e.tier === 1 &&
            Date.parse(e.at) >= since,
        );
        const share = notices.length ? notices.filter(e => e.prime).length / notices.length : null;
        const primeSubs = subs && share !== null ? Math.round(subs.tier1 * share) : 0;
        const subsUsd =
          subs && values
            ? round(
                (subs.tier1 - primeSubs) * (values.tier1 ?? 0) +
                  primeSubs * (values.prime ?? PRIME_DEFAULT) +
                  (subs.tier2 ?? 0) * (values.tier2 ?? 0) +
                  (subs.tier3 ?? 0) * (values.tier3 ?? 0),
              )
            : null;
        const bitsUsd = bits === null ? null : round(bits * BIT_VALUE);
        const monthEvents = (s.streamEvents ?? []).filter(
          e => e.workspaceId === w && e.channelId === c.id && localDateTime(e.at)?.date.slice(0, 7) === month,
        );
        const count = type => monthEvents.filter(e => e.type === type).reduce((n, e) => n + (e.amount ?? 0), 0);
        return {
          channelId: c.id,
          name: c.name,
          month,
          subs,
          bits,
          values,
          prime: { estimated: primeSubs, share: share === null ? null : round(share, 3), samples: notices.length },
          estimate: {
            subs: subsUsd,
            bits: bitsUsd,
            total: subsUsd === null && bitsUsd === null ? null : round((subsUsd ?? 0) + (bitsUsd ?? 0)),
            currency: 'USD',
          },
          monthEvents: { subs: count('sub'), resubs: count('resub'), gifts: count('gift'), bits: count('cheer') },
          bitsHistory: c.bitsByMonth ?? {},
          missing: missing(s, c),
          observedAt: signals?.observedAt ?? null,
        };
      });
    return { month, bitValue: BIT_VALUE, primeDefault: PRIME_DEFAULT, items };
  }

  /**
   * Net US$ the creator receives per active subscriber of each tier (their split, after Twitch's share) and per
   * Prime Gaming sub (a fixed amount by the viewer's country, not a split).
   */
  async function setRevenueSettings(w, id, body) {
    objectBody(body, VALUES);
    const values = {};
    for (const tier of VALUES) {
      const v = body[tier];
      if (v === undefined || v === null) {
        values[tier] = null;
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100)
        fail(400, 'INVALID_FIELD', `${tier} deve ser um valor entre 0 e 100 (US$ por inscrição).`);
      values[tier] = round(v);
    }
    return repository.update(s => {
      const channel = s.channels.find(c => c.workspaceId === w && c.id === id);
      if (!channel || channel.platform !== 'Twitch') fail(404, 'CHANNEL_NOT_FOUND', 'Canal Twitch não encontrado.');
      channel.revenueSettings = values;
      return values;
    });
  }

  return { sessions, analytics, revenue, setRevenueSettings };
}
