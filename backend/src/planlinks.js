import { planChannelIds } from './model.js';

/**
 * Automatic links between plans, published content and brand deals.
 *
 * - A plan is linked to the content that fulfilled it: the one picked by hand; else, for a plan tied to a brand
 *   deal, content matching the deal's keywords within the deal's window; else, for a live, the VOD/live of the same
 *   day on one of its channels; else, for other formats, an upload up to 2 days away with a similar title.
 *   Each content fulfils one plan at most, and deal plans pick first (a regular live never takes a deal's content).
 * - Published content no plan claims is shown on the calendar as a record (clips excluded), with the deal it
 *   delivers when its title/tags/game match a confirmed deal's keywords within the deal's window.
 * Nothing here is stored: links are worked out on every read from the current data.
 */
export const TIMEZONE = 'America/Sao_Paulo';
const localFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
/** ISO instant → local (São Paulo) { date: YYYY-MM-DD, time: HH:MM }. */
export function localDateTime(iso) {
  const time = Date.parse(iso ?? '');
  if (Number.isNaN(time)) return null;
  const [date, clock] = localFormat.format(new Date(time)).split(' ');
  return { date, time: clock };
}
export const normalize = value =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const words = value =>
  new Set(
    normalize(value)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(w => w.length > 2),
  );
/** Same title once case/accents are ignored, one containing the other, or at least half of the words shared. */
export function similarTitles(a, b) {
  const x = normalize(a),
    y = normalize(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const p = words(a),
    q = words(b);
  if (!p.size || !q.size) return false;
  const shared = [...p].filter(w => q.has(w)).length;
  return shared / Math.min(p.size, q.size) >= 0.5;
}
const days = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
/** Duration "4h44m50s" / "123s" / "PT1H2M" → seconds. */
function seconds(duration) {
  const text = String(duration ?? '');
  const match = text.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}
/** Local day of a content (its publication instant), falling back to the stored date. */
export const contentDay = content => localDateTime(content.publishedAt)?.date ?? content.date;
/** Most frequent game among live snapshots of a channel within [from, to] (ISO), or null. */
function gameBetween(state, workspaceId, channelId, from, to) {
  const count = new Map();
  for (const s of state.streamSnapshots ?? [])
    if (
      s.workspaceId === workspaceId &&
      s.channelId === channelId &&
      s.isLive &&
      s.game &&
      s.observedAt >= from &&
      s.observedAt <= to
    )
      count.set(s.game, (count.get(s.game) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
/** Game of a content: stored, or (VOD/live) the one seen live while it was being streamed. */
export function contentGame(state, content) {
  if (content.game) return content.game;
  if (!['VOD', 'Live'].includes(content.format) || !content.publishedAt) return null;
  const start = Date.parse(content.publishedAt);
  if (Number.isNaN(start)) return null;
  const end = new Date(start + Math.max(seconds(content.duration), 3600) * 1000).toISOString();
  return gameBetween(state, content.workspaceId, content.channelId, content.publishedAt, end);
}
/** The deal's window: from its date to its end date (one day when there is no end date). */
export const dealWindow = deal => [deal.date, deal.endDate && deal.endDate >= deal.date ? deal.endDate : deal.date];
/** Whether a content delivers a deal: published within the deal's window and mentioning one of its keywords. */
export function deliversDeal(state, deal, content) {
  if (!deal.keywords?.length) return false;
  const [from, to] = dealWindow(deal),
    day = contentDay(content);
  if (!day || day < from || day > to) return false;
  const haystack = normalize([content.title, ...(content.tags ?? []), contentGame(state, content)].join(' '));
  return deal.keywords.some(k => normalize(k) && haystack.includes(normalize(k)));
}

/**
 * Plan id → { content, linked: 'manual' | 'deal' | 'auto' } for every plan of a workspace that has a link.
 * `today` (YYYY-MM-DD) decides which plans are already due (past plans are linked whatever their stage).
 */
export function linkPlans(state, workspaceId, today = localDateTime(new Date().toISOString()).date) {
  const contents = state.contents.filter(c => c.workspaceId === workspaceId && c.format !== 'Clip');
  const deals = new Map(
    (state.financial ?? []).filter(f => f.workspaceId === workspaceId && f.type === 'deal').map(f => [f.id, f]),
  );
  const plans = state.plans.filter(p => p.workspaceId === workspaceId);
  const links = new Map(),
    used = new Set();
  const link = (plan, content, linked) => {
    links.set(plan.id, { content, linked });
    used.add(content.id);
  };
  const free = plan => {
    const channels = new Set(planChannelIds(plan));
    return contents.filter(c => channels.has(c.channelId) && !used.has(c.id));
  };
  const closest = (plan, list) =>
    list.sort((a, b) => Math.abs(days(contentDay(a), plan.date)) - Math.abs(days(contentDay(b), plan.date)))[0];
  // 1. Picked by hand.
  for (const plan of plans) {
    if (!plan.contentId) continue;
    const content = contents.find(c => c.id === plan.contentId && planChannelIds(plan).includes(c.channelId));
    if (content) link(plan, content, 'manual');
  }
  const open = plans.filter(p => !links.has(p.id) && !p.contentId);
  // 2. Plans of a brand deal: content matching the deal's keywords within its window.
  for (const plan of open) {
    const deal = deals.get(plan.dealId);
    if (!deal) continue;
    const match = closest(
      plan,
      free(plan).filter(c => deliversDeal(state, deal, c)),
    );
    if (match) link(plan, match, 'deal');
  }
  // 3. Everything else that is due: deal plans first, then by date.
  const due = open
    .filter(p => !links.has(p.id) && (p.stage === 'Pronto' || p.stage === 'Publicado' || p.date <= today))
    .sort((a, b) => Number(Boolean(b.dealId)) - Number(Boolean(a.dealId)) || a.date.localeCompare(b.date));
  for (const plan of due) {
    const candidates = free(plan);
    const sameDayLive =
      plan.format === 'Live' &&
      closest(
        plan,
        candidates.filter(c => ['VOD', 'Live'].includes(c.format) && contentDay(c) === plan.date),
      );
    const nearSimilar =
      plan.format !== 'Live' &&
      closest(
        plan,
        candidates.filter(
          c =>
            Math.abs(days(contentDay(c), plan.date)) <= 2 && c.format !== 'VOD' && similarTitles(c.title, plan.title),
        ),
      );
    // Same title (case/accents ignored), published after the plan was created, at any distance.
    const since = (plan.createdAt ?? '').slice(0, 10);
    const sameTitle = candidates
      .filter(c => normalize(c.title) === normalize(plan.title) && String(contentDay(c)) >= since)
      .sort((a, b) => String(contentDay(a)).localeCompare(String(contentDay(b))))[0];
    const match = sameDayLive || nearSimilar || sameTitle;
    if (match) link(plan, match, 'auto');
  }
  return links;
}

/**
 * Calendar records: published content in [from, to] on the given channels that no plan claims (clips excluded),
 * and Twitch/Kick lives seen by the sync with no VOD (Kick has no VOD catalog). Each carries its game and the
 * confirmed/received deal it delivers, if any.
 */
export function planRecords(state, workspaceId, { from, to, channelIds, links }) {
  const channels = new Set(channelIds);
  const claimed = new Set([...links.values()].map(l => l.content.id));
  const deals = (state.financial ?? []).filter(
    f => f.workspaceId === workspaceId && f.type === 'deal' && ['Confirmado', 'Recebido'].includes(f.stage),
  );
  const dealOf = content => {
    const deal = deals.find(d => deliversDeal(state, d, content));
    return deal ? { id: deal.id, title: deal.title } : null;
  };
  const platformOf = id => state.channels.find(c => c.id === id)?.platform;
  const records = [];
  for (const c of state.contents) {
    if (c.workspaceId !== workspaceId || !channels.has(c.channelId) || c.format === 'Clip') continue;
    const day = contentDay(c);
    if (!day || day < from || day > to || claimed.has(c.id)) continue; // a plan shows it instead
    const at = localDateTime(c.publishedAt);
    records.push({
      id: c.id,
      kind: 'content',
      channelId: c.channelId,
      platform: c.platform ?? platformOf(c.channelId),
      title: c.title,
      format: c.format,
      date: day,
      time: at?.time ?? null,
      thumbnailUrl: c.thumbnailUrl ?? null,
      watchUrl: c.watchUrl ?? null,
      views: c.views ?? null,
      game: contentGame(state, c),
      deal: dealOf(c),
    });
  }
  // Lives seen by the sync (Twitch/Kick): one record per broadcast, unless a VOD of it exists.
  const sessions = new Map();
  for (const s of state.streamSnapshots ?? []) {
    if (s.workspaceId !== workspaceId || !s.isLive || !channels.has(s.channelId)) continue;
    const started = s.startedAt ?? s.observedAt,
      key = s.channelId + '|' + started;
    const session = sessions.get(key) ?? { channelId: s.channelId, started, snapshots: [] };
    session.snapshots.push(s);
    sessions.set(key, session);
  }
  for (const session of sessions.values()) {
    const at = localDateTime(session.started);
    if (!at || at.date < from || at.date > to) continue;
    const start = Date.parse(session.started);
    const vod = state.contents.some(
      c =>
        c.workspaceId === workspaceId &&
        c.channelId === session.channelId &&
        c.format !== 'Clip' &&
        Math.abs(Date.parse(c.publishedAt) - start) < 45 * 60000,
    );
    if (vod) continue;
    const last = session.snapshots.at(-1);
    const games = new Map();
    for (const s of session.snapshots) if (s.game) games.set(s.game, (games.get(s.game) ?? 0) + 1);
    const content = {
      title: last.title || 'Live',
      tags: [],
      game: [...games].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      publishedAt: session.started,
      date: at.date,
    };
    records.push({
      id: 'live-' + session.channelId + '-' + session.started,
      kind: 'live',
      channelId: session.channelId,
      platform: platformOf(session.channelId),
      title: content.title,
      format: 'Live',
      date: at.date,
      time: at.time,
      thumbnailUrl: last.thumbnailUrl ?? null,
      watchUrl: state.channels.find(c => c.id === session.channelId)?.watchUrl ?? null,
      views: null,
      game: content.game,
      deal: dealOf(content),
    });
  }
  return records.sort((a, b) => a.date.localeCompare(b.date) || String(a.time).localeCompare(String(b.time)));
}
