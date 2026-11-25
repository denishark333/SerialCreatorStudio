import { createHash } from 'node:crypto';

const ENDPOINT = 'wss://eventsub.wss.twitch.tv/ws';
const BACKOFF = [5000, 30000, 120000, 600000];

/** Subscriptions opened for a Twitch channel, each only when the connection granted its scope. */
function subscriptionsFor(broadcasterId, scopes) {
  const has = scope => !scope || scopes.has(scope);
  const me = { broadcaster_user_id: broadcasterId };
  return [
    ['stream.online', '1', me],
    ['stream.offline', '1', me],
    ['channel.raid', '1', { to_broadcaster_user_id: broadcasterId }],
    ['channel.subscribe', '1', me, 'channel:read:subscriptions'],
    ['channel.subscription.message', '1', me, 'channel:read:subscriptions'],
    ['channel.subscription.gift', '1', me, 'channel:read:subscriptions'],
    ['channel.cheer', '1', me, 'bits:read'],
    ['channel.chat.message', '1', { ...me, user_id: broadcasterId }, 'user:read:chat'],
    // Sub announcements in chat: the only place the API says whether a sub was Prime.
    ['channel.chat.notification', '1', { ...me, user_id: broadcasterId }, 'user:read:chat'],
  ]
    .filter(([, , , scope]) => has(scope))
    .map(([type, version, condition]) => ({ type, version, condition }));
}
const tierOf = tier => (tier === '3000' ? 3 : tier === '2000' ? 2 : 1);

/**
 * Twitch EventSub over WebSocket (no public callback needed): one socket per connected Twitch channel, opened with
 * the channel's own token. Stores what the Helix API cannot answer later:
 * - `streamEvents`: raids received (raider and size), new subs, resubs, gifts and bits — amounts only, no viewer
 *   identities;
 * - `chatSessions`: messages and unique chatters per live. Chatters are counted through salted hashes, kept only
 *   while the live is on and dropped when it ends.
 * Writes are batched (events every few seconds, chat every `flushMs`) so a busy chat never floods the storage.
 */
export function createEventSub({
  repository,
  streams,
  WebSocketImpl = globalThis.WebSocket,
  logger = console,
  endpoint = ENDPOINT,
  flushMs = 60000,
  eventFlushMs = 5000,
  reconcileMs = 60000,
  now = () => Date.now(),
}) {
  const sockets = new Map(); // connectionId -> socket state
  const chats = new Map(); // channelId -> live chat tally
  const lives = new Map(); // channelId -> startedAt (ISO) while live, from stream.online/offline
  let pending = [],
    timers = [],
    stopped = true,
    eventFlushTask = null;

  const channelOf = connection =>
    repository.snapshot().channels.find(c => c.connectionId === connection.id && c.platform === 'Twitch');
  const keyOf = connection => connection.id + '|' + [...(connection.scopes ?? [])].sort().join(' ');

  function liveStart(channel) {
    if (lives.has(channel.id)) return lives.get(channel.id);
    const current = repository.snapshot().channels.find(c => c.id === channel.id)?.live;
    return current?.isLive && current.startedAt ? current.startedAt : null;
  }

  function flushEvents() {
    // Timer, manual flush and shutdown may overlap: only one batch writes at a time.
    if (eventFlushTask) return eventFlushTask;
    if (!pending.length) return Promise.resolve();
    const batch = pending;
    pending = [];
    eventFlushTask = Promise.resolve()
      .then(async () => {
        try {
          await repository.update(s => {
            s.streamEvents ??= [];
            const known = new Set(s.streamEvents.map(e => e.id));
            for (const row of batch)
              if (
                !known.has(row.id) &&
                s.channels.some(c => c.workspaceId === row.workspaceId && c.id === row.channelId)
              ) {
                s.streamEvents.push(row);
                known.add(row.id);
              }
          });
        } catch (error) {
          // Preserve failed events ahead of arrivals received during the write. The
          // next flush retries, checking channel ownership and saved IDs again.
          pending = [...new Map([...batch, ...pending].map(row => [row.id, row])).values()];
          logger.error({ code: 'EVENTSUB_STORE_FAILED', error: error?.message, pendingCount: pending.length });
        }
      })
      .finally(() => {
        eventFlushTask = null;
      });
    return eventFlushTask;
  }

  async function flushChats() {
    const dirty = [...chats.values()].filter(c => c.dirty);
    if (!dirty.length) return;
    for (const c of dirty) c.dirty = false;
    try {
      await repository.update(s => {
        s.chatSessions ??= [];
        for (const c of dirty) {
          if (!s.channels.some(ch => ch.workspaceId === c.workspaceId && ch.id === c.channelId)) continue;
          const row = {
            id: 'chat-' + c.channelId + '-' + c.startedAt,
            workspaceId: c.workspaceId,
            channelId: c.channelId,
            startedAt: c.startedAt,
            messages: c.messages,
            chatters: c.hashes.size,
            ...(c.ended ? { endedAt: c.ended } : { hashes: [...c.hashes] }),
          };
          const old = s.chatSessions.findIndex(v => v.id === row.id);
          if (old >= 0) s.chatSessions[old] = row;
          else s.chatSessions.push(row);
        }
      });
    } catch (error) {
      for (const c of dirty) c.dirty = true;
      logger.error({ code: 'EVENTSUB_CHAT_STORE_FAILED', error: error?.message });
    }
    for (const c of dirty) if (c.ended && !c.dirty && chats.get(c.channelId) === c) chats.delete(c.channelId);
  }

  function tally(channel, startedAt) {
    let c = chats.get(channel.id);
    if (c && c.startedAt !== startedAt) {
      c.ended ??= new Date(now()).toISOString();
      c.dirty = true;
      c = null;
    }
    if (!c) {
      // Resume a live already being counted (API restart in the middle of a broadcast).
      const saved = (repository.snapshot().chatSessions ?? []).find(
        v => v.id === 'chat-' + channel.id + '-' + startedAt && v.hashes,
      );
      c = {
        workspaceId: channel.workspaceId,
        channelId: channel.id,
        startedAt,
        messages: saved?.messages ?? 0,
        hashes: new Set(saved?.hashes ?? []),
        dirty: false,
      };
      chats.set(channel.id, c);
    }
    return c;
  }

  function endLive(channel) {
    lives.delete(channel.id);
    const c = chats.get(channel.id);
    if (c && !c.ended) {
      c.ended = new Date(now()).toISOString();
      c.dirty = true;
      void flushChats();
    }
  }

  function handle(channel, type, event, metadata) {
    const base = {
      id: 'evt-' + metadata.message_id,
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      at: metadata.message_timestamp ?? new Date(now()).toISOString(),
    };
    switch (type) {
      case 'stream.online':
        lives.set(channel.id, new Date(event.started_at ?? now()).toISOString().replace('.000Z', 'Z'));
        return;
      case 'stream.offline':
        return endLive(channel);
      case 'channel.raid':
        pending.push({
          ...base,
          type: 'raid',
          from: event.from_broadcaster_user_name ?? event.from_broadcaster_user_login ?? null,
          fromLogin: event.from_broadcaster_user_login ?? null,
          amount: Number(event.viewers) || 0,
        });
        return;
      case 'channel.subscribe':
        // Gifted subs arrive here once per recipient; they are counted by the gift event instead.
        if (!event.is_gift) pending.push({ ...base, type: 'sub', tier: tierOf(event.tier), amount: 1 });
        return;
      case 'channel.subscription.message':
        pending.push({ ...base, type: 'resub', tier: tierOf(event.tier), amount: 1 });
        return;
      case 'channel.subscription.gift':
        pending.push({ ...base, type: 'gift', tier: tierOf(event.tier), amount: Number(event.total) || 1 });
        return;
      case 'channel.chat.notification': {
        // New subs are always announced; resubs only when the viewer shares them. Gifted ones are left out.
        const sub = event.notice_type === 'sub' ? event.sub : event.notice_type === 'resub' ? event.resub : null;
        if (!sub || sub.is_gift) return;
        pending.push({ ...base, type: 'notice', tier: tierOf(sub.sub_tier), prime: sub.is_prime === true, amount: 1 });
        return;
      }
      case 'channel.cheer':
        pending.push({ ...base, type: 'cheer', amount: Number(event.bits) || 0 });
        return;
      case 'channel.chat.message': {
        if (!event.chatter_user_id || event.chatter_user_id === channel.externalId) return;
        const startedAt = liveStart(channel);
        if (!startedAt) return; // Off-air chat is not part of any live.
        const c = tally(channel, startedAt);
        c.messages++;
        c.hashes.add(
          createHash('sha256')
            .update(channel.workspaceId + ':' + event.chatter_user_id)
            .digest('base64url')
            .slice(0, 16),
        );
        c.dirty = true;
        return;
      }
    }
  }

  async function subscribe(state, sessionId) {
    const connection = repository.snapshot().connections.find(c => c.id === state.connectionId);
    const channel = connection && channelOf(connection);
    if (!channel) return;
    let created = 0;
    for (const sub of subscriptionsFor(channel.externalId, new Set(connection.scopes ?? []))) {
      try {
        await streams.helix(connection, 'eventsub/subscriptions', {
          body: { ...sub, transport: { method: 'websocket', session_id: sessionId } },
        });
        created++;
      } catch (error) {
        logger.error({ code: 'EVENTSUB_SUBSCRIBE_FAILED', type: sub.type, error: error?.code ?? error?.message });
        if (error?.code === 'PROVIDER_REAUTHORIZE') break;
      }
    }
    if (!created) state.socket?.close();
  }

  /**
   * Opens a socket for a connection. A fresh open subscribes after the welcome; `reconnect` (Twitch asked us to move
   * to `url`) keeps the subscriptions and swaps sockets once the new one is welcomed.
   */
  function open(connection, url = endpoint, state = null, reconnect = false) {
    const channel = channelOf(connection);
    if (!channel) return null;
    if (!state) {
      state = { connectionId: connection.id, key: keyOf(connection), attempt: 0, socket: null };
      sockets.set(connection.id, state);
    }
    const ws = new WebSocketImpl(url);
    if (!reconnect) state.socket = ws;
    const arm = seconds => {
      clearTimeout(state.watchdog);
      state.watchdog = setTimeout(() => ws.close(), (seconds + 10) * 1000);
      state.watchdog.unref?.();
    };
    if (!reconnect) arm(10); // No welcome within 20 s: give up and retry.
    ws.onmessage = message => {
      let data;
      try {
        data = JSON.parse(String(message.data));
      } catch {
        return;
      }
      const meta = data.metadata ?? {},
        payload = data.payload ?? {};
      if (meta.message_type === 'session_welcome') {
        if (reconnect) {
          const old = state.socket;
          state.socket = ws;
          if (old && old !== ws) {
            old.onclose = null;
            old.close();
          }
        } else if (state.socket === ws) void subscribe(state, payload.session?.id);
        state.keepalive = payload.session?.keepalive_timeout_seconds ?? 10;
        state.attempt = 0;
        if (state.socket === ws) arm(state.keepalive);
        return;
      }
      if (ws !== state.socket) return;
      arm(state.keepalive ?? 10);
      if (meta.message_type === 'notification') {
        const current = repository.snapshot().channels.find(c => c.id === channel.id);
        if (current) handle(current, payload.subscription?.type, payload.event ?? {}, meta);
      } else if (meta.message_type === 'session_reconnect' && payload.session?.reconnect_url)
        open(connection, payload.session.reconnect_url, state, true);
    };
    ws.onclose = () => {
      if (ws !== state.socket) return; // A replaced socket, or a reconnect target that never took over.
      clearTimeout(state.watchdog);
      state.socket = null;
      if (stopped || sockets.get(connection.id) !== state) return;
      const delay = BACKOFF[Math.min(state.attempt++, BACKOFF.length - 1)];
      state.retry = setTimeout(() => {
        const fresh = repository.snapshot().connections.find(c => c.id === connection.id);
        if (fresh && sockets.get(connection.id) === state && !stopped) open(fresh, endpoint, state);
      }, delay);
      state.retry.unref?.();
    };
    ws.onerror = () => {};
    return state;
  }

  function close(connectionId) {
    const state = sockets.get(connectionId);
    sockets.delete(connectionId);
    if (!state) return;
    clearTimeout(state.watchdog);
    clearTimeout(state.retry);
    if (state.socket) {
      state.socket.onclose = null;
      state.socket.close();
    }
  }

  /** Opens sockets for new Twitch connections, reopens those whose grant changed and closes removed ones. */
  function reconcile() {
    if (stopped || !WebSocketImpl || !streams.configured('Twitch')) return;
    const connections = repository
      .read()
      .connections.filter(c => c.platform === 'Twitch' && c.status === 'connected' && c.encryptedTokens);
    const wanted = new Map(connections.map(c => [c.id, c]));
    for (const id of [...sockets.keys()])
      if (!wanted.has(id) || sockets.get(id).key !== keyOf(wanted.get(id))) close(id);
    for (const c of connections) if (!sockets.has(c.id) && channelOf(c)) open(c);
    for (const [channelId, c] of chats)
      if (!repository.snapshot().channels.some(ch => ch.id === channelId && ch.workspaceId === c.workspaceId))
        chats.delete(channelId);
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      reconcile();
      for (const [fn, ms] of [
        [reconcile, reconcileMs],
        [flushEvents, eventFlushMs],
        [flushChats, flushMs],
      ]) {
        const t = setInterval(() => void fn(), ms);
        t.unref?.();
        timers.push(t);
      }
    },
    async stop() {
      stopped = true;
      for (const t of timers) clearInterval(t);
      timers = [];
      for (const id of [...sockets.keys()]) close(id);
      // Drain arrivals queued while the previous write was in flight.
      await eventFlushTask;
      await flushEvents();
      await flushChats();
    },
    reconcile,
    flush: async () => {
      await flushEvents();
      await flushChats();
    },
    /** Test/diagnostic view: connection ids with an open socket. */
    connected: () => [...sockets.entries()].filter(([, s]) => s.socket).map(([id]) => id),
  };
}
