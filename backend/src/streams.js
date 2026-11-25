import { oauthReturn } from './oauth-return.js';
import { randomBytes, createHash } from 'node:crypto';
import { fail } from './errors.js';
import { detachPlanChannels } from './model.js';
import { readJsonSafely } from './http/provider.js';
const random = () => randomBytes(32).toString('base64url');
const definitions = {
  Twitch: {
    host: 'https://id.twitch.tv/oauth2',
    api: 'https://api.twitch.tv/helix/',
    // bits:read → monthly bits and cheer events; user:read:chat → unique chatters per live (EventSub).
    scopes: ['moderator:read:followers', 'channel:read:subscriptions', 'bits:read', 'user:read:chat'],
  },
  Kick: {
    host: 'https://id.kick.com/oauth',
    api: 'https://api.kick.com/public/v1/',
    scopes: ['user:read', 'channel:read'],
  },
};
const safe = c => ({
  id: c.id,
  platform: c.platform,
  status: c.status,
  channelIds: c.channelIds,
  scopes: c.scopes,
  lastSyncedAt: c.lastSyncedAt ?? null,
  lastError: c.lastError ?? null,
});
export function createStreams({
  repository,
  vault,
  auth = null,
  configs = {},
  dashboardUrl = 'http://localhost:5173',
  fetcher = fetch,
}) {
  const tickets = new Map(),
    states = new Map(),
    locks = new Set(),
    validated = new Map();
  let validationTimer;
  const settings = p => ({ ...definitions[p], ...configs[p] });
  const prune = () => {
    for (const map of [tickets, states]) for (const [k, v] of map) if (v.expires < Date.now()) map.delete(k);
  };
  function config(p) {
    const c = settings(p);
    if (!c.clientId || !c.clientSecret)
      fail(
        503,
        'PROVIDER_NOT_CONFIGURED',
        `Configure ${p.toUpperCase()}_CLIENT_ID e ${p.toUpperCase()}_CLIENT_SECRET no backend.`,
      );
    return c;
  }
  async function json(url, options = {}) {
    let r;
    try {
      r = await fetcher(url, { ...options, signal: AbortSignal.timeout(20000) });
    } catch {
      fail(424, 'PROVIDER_NETWORK_ERROR', 'Falha de rede ao consultar a plataforma.');
    }
    const data = await readJsonSafely(r);
    if (!r.ok)
      fail(
        r.status === 401 ? 401 : 424,
        r.status === 401 ? 'PROVIDER_REAUTHORIZE' : 'PROVIDER_API_ERROR',
        `A plataforma recusou a consulta (HTTP ${r.status}).`,
        { providerStatus: r.status },
      );
    if (data === null)
      fail(424, 'PROVIDER_INVALID_RESPONSE', 'A plataforma retornou uma resposta inválida. Tente novamente.', {
        providerStatus: r.status,
      });
    return data;
  }
  async function exchange(p, values) {
    const c = config(p);
    const result = await json(c.host + '/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...values }).toString(),
    });
    if (!result.access_token) fail(424, 'INVALID_TOKEN_RESPONSE', 'A plataforma não retornou uma autorização válida.');
    return { ...result, expiresAt: Date.now() + Number(result.expires_in ?? 3600) * 1000 };
  }
  const api = (p, t, path, params = {}, body = undefined) => {
    const c = settings(p);
    return json(c.api + path + '?' + new URLSearchParams(params), {
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
      headers: {
        Authorization: 'Bearer ' + t,
        ...(p === 'Twitch' ? { 'Client-Id': c.clientId } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  };
  /** Active subscribers by tier (gifts included in their tier), without the broadcaster's own subscription. */
  async function subscriptionTiers(t, broadcasterId) {
    const tiers = { tier1: 0, tier2: 0, tier3: 0, gifted: 0 };
    let cursor = '',
      pages = 0,
      total = null,
      complete = true;
    do {
      const r = await api('Twitch', t, 'subscriptions', {
        broadcaster_id: broadcasterId,
        first: '100',
        ...(cursor ? { after: cursor } : {}),
      });
      total = r.total ?? total;
      for (const sub of r.data ?? []) {
        if (sub.user_id === broadcasterId) continue;
        tiers[sub.tier === '3000' ? 'tier3' : sub.tier === '2000' ? 'tier2' : 'tier1']++;
        if (sub.is_gift) tiers.gifted++;
      }
      cursor = r.pagination?.cursor ?? '';
      pages++;
    } while (cursor && pages < 30);
    if (cursor) complete = false;
    return { ...tiers, total, complete };
  }
  /** Bits cheered this month (São Paulo month), summed from the month leaderboard (top 100 cheerers). */
  async function monthBits(t) {
    const month = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
    const r = await api('Twitch', t, 'bits/leaderboard', {
      count: '100',
      period: 'month',
      started_at: month + '-15T12:00:00Z',
    });
    return { month, total: (r.data ?? []).reduce((n, row) => n + (Number(row.score) || 0), 0) };
  }
  async function profile(p, t) {
    if (p === 'Twitch') {
      const user = (await api(p, t, 'users')).data?.[0];
      if (!user?.id) fail(424, 'PROFILE_NOT_FOUND', 'Canal Twitch não encontrado.');
      return {
        externalId: user.id,
        name: user.display_name,
        slug: user.login,
        thumbnailUrl: user.profile_image_url,
        watchUrl: 'https://www.twitch.tv/' + user.login,
      };
    }
    const user = (await api(p, t, 'users')).data?.[0];
    if (!user?.user_id) fail(424, 'PROFILE_NOT_FOUND', 'Usuário Kick não encontrado.');
    const channel = (await api(p, t, 'channels', { broadcaster_user_id: String(user.user_id) })).data?.[0];
    if (!channel?.slug) fail(422, 'PROFILE_NOT_FOUND', 'Nenhum canal Kick foi encontrado para esta conta.');
    return {
      externalId: String(user.user_id),
      name: user.name ?? channel.slug,
      slug: channel.slug,
      thumbnailUrl: user.profile_picture ?? null,
      watchUrl: 'https://kick.com/' + channel.slug,
    };
  }
  async function credentials(connection) {
    let tokens = vault.open(connection.encryptedTokens);
    const p = connection.platform;
    if (!tokens.expiresAt || tokens.expiresAt < Date.now() + 60000) {
      if (!tokens.refresh_token) fail(401, 'PROVIDER_REAUTHORIZE', 'Reconecte este canal.');
      let fresh;
      try {
        fresh = await exchange(p, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
      } catch (error) {
        // 400/401 from the token endpoint = refresh token revoked, expired or rotated: only a new consent fixes it.
        if ([400, 401].includes(error.details?.providerStatus))
          fail(401, 'PROVIDER_REAUTHORIZE', 'A plataforma recusou a renovação da autorização. Reconecte este canal.');
        throw error;
      }
      tokens = { ...tokens, ...fresh, refresh_token: fresh.refresh_token ?? tokens.refresh_token };
      await repository.update(s => {
        const c = s.connections.find(c => c.id === connection.id);
        if (c && JSON.stringify(c.encryptedTokens) === JSON.stringify(connection.encryptedTokens))
          c.encryptedTokens = vault.seal(tokens);
      });
    }
    if (p === 'Twitch' && (!validated.has(connection.id) || Date.now() - validated.get(connection.id) > 3500000)) {
      const valid = await json('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: 'OAuth ' + tokens.access_token },
      });
      if (
        valid.client_id !== settings(p).clientId ||
        !repository.snapshot().channels.some(c => c.connectionId === connection.id && c.externalId === valid.user_id)
      )
        fail(401, 'PROVIDER_REAUTHORIZE', 'Autorização Twitch não corresponde a este canal.');
      validated.set(connection.id, Date.now());
      await repository.update(s => {
        const c = s.connections.find(c => c.id === connection.id);
        if (c) c.validatedAt = new Date().toISOString();
      });
    }
    return tokens.access_token;
  }
  async function sync(w, id) {
    const initial = repository.snapshot(),
      channel = initial.channels.find(
        c => c.workspaceId === w && c.id === id && ['Twitch', 'Kick'].includes(c.platform),
      );
    if (!channel) fail(404, 'CHANNEL_NOT_FOUND', 'Canal não encontrado.');
    const connection = initial.connections.find(c => c.workspaceId === w && c.id === channel.connectionId);
    if (!connection) fail(404, 'CONNECTION_NOT_FOUND', 'Conexão não encontrada.');
    if (locks.has(connection.id)) fail(409, 'SYNC_IN_PROGRESS', 'Coleta em andamento.');
    locks.add(connection.id);
    try {
      const p = channel.platform,
        t = await credentials(connection),
        observedAt = new Date().toISOString(),
        info = await profile(p, t);
      let live = null,
        followers = null,
        paidSubscribers = null,
        revenue = null;
      const contents = [],
        warnings = [];
      if (p === 'Twitch') {
        const current = (await api(p, t, 'streams', { user_id: channel.externalId })).data?.[0];
        live = current
          ? {
              isLive: true,
              title: current.title,
              game: current.game_name || null,
              viewers: current.viewer_count,
              startedAt: current.started_at,
              thumbnailUrl: current.thumbnail_url?.replace('{width}', '640').replace('{height}', '360'),
            }
          : { isLive: false, viewers: null };
        for (const [path, key] of [
          ['channels/followers', 'followers'],
          ['subscriptions', 'paidSubscribers'],
        ])
          try {
            const r = await api(p, t, path, { broadcaster_id: channel.externalId, first: '1' });
            if (key === 'followers') followers = r.total ?? null;
            else paidSubscribers = r.total ?? null;
          } catch (e) {
            warnings.push({ section: key, reason: e.message });
          }
        // Revenue signals for the estimate: subscribers by tier and this month's bits (when authorized).
        const granted = new Set(connection.scopes ?? []);
        revenue = { subs: null, bits: null, observedAt };
        try {
          revenue.subs = await subscriptionTiers(t, channel.externalId);
        } catch (e) {
          warnings.push({ section: 'subscriptionTiers', reason: e.message });
        }
        if (granted.has('bits:read'))
          try {
            revenue.bits = await monthBits(t);
          } catch (e) {
            warnings.push({ section: 'bits', reason: e.message });
          }
        for (const [path, kind] of [
          ['videos', 'video'],
          ['clips', 'clip'],
        ]) {
          let cursor = channel[path + 'Cursor'] ?? '',
            pages = 0;
          do {
            const result = await api(p, t, path, {
              [kind === 'video' ? 'user_id' : 'broadcaster_id']: channel.externalId,
              first: '100',
              ...(kind === 'clip' ? { started_at: '2016-01-01T00:00:00Z', ended_at: observedAt } : {}),
              ...(cursor ? { after: cursor } : {}),
            });
            for (const v of result.data ?? [])
              contents.push({
                id: 'twitch-' + kind + '-' + v.id,
                workspaceId: w,
                channelId: id,
                externalId: v.id,
                platform: p,
                title: v.title,
                tags: [],
                description: v.description ?? '',
                date: v.created_at.slice(0, 10),
                publishedAt: v.created_at,
                duration: typeof v.duration === 'number' ? String(Math.round(v.duration)) + 's' : v.duration,
                format: kind === 'clip' ? 'Clip' : v.type === 'archive' ? 'VOD' : 'Vídeo',
                formatClassification: 'provider_metadata',
                status: 'Público',
                views: v.view_count ?? null,
                likes: null,
                comments: null,
                retention: null,
                image: '',
                thumbnailUrl: (v.thumbnail_url ?? '').replace('%{width}', '640').replace('%{height}', '360'),
                watchUrl: v.url,
                dataSource: 'twitch',
                lastSyncedAt: observedAt,
              });
            cursor = result.pagination?.cursor ?? '';
            pages++;
          } while (cursor && pages < 10);
          await repository.update(s => {
            const c = s.channels.find(c => c.id === id && c.workspaceId === w);
            if (c) c[path + 'Cursor'] = cursor || null;
          });
          if (cursor)
            warnings.push({ section: path, reason: 'Catálogo parcial; a próxima coleta retomará a paginação.' });
        }
      } else {
        const c = (await api(p, t, 'channels', { broadcaster_user_id: channel.externalId })).data?.[0];
        if (!c) fail(424, 'CHANNEL_NOT_FOUND', 'Canal Kick não retornado.');
        live = {
          isLive: c.stream?.is_live === true,
          title: c.stream_title ?? '',
          game: c.category?.name || null,
          viewers: c.stream?.is_live ? (c.stream.viewer_count ?? null) : null,
          startedAt: c.stream?.start_time ?? null,
          thumbnailUrl: c.stream?.thumbnail ?? null,
        };
        paidSubscribers = c.active_subscribers_count ?? null;
      }
      await repository.update(s => {
        const c = s.channels.find(c => c.workspaceId === w && c.id === id);
        if (!c) return;
        Object.assign(c, info, {
          followers,
          paidSubscribers,
          live,
          lastSyncedAt: observedAt,
          warnings,
          capabilities: { catalog: p === 'Twitch', live: true, analytics: false, revenue: false, comments: false },
          ...(revenue
            ? {
                twitchRevenue: revenue,
                ...(revenue.bits
                  ? {
                      bitsByMonth: Object.fromEntries(
                        Object.entries({ ...c.bitsByMonth, [revenue.bits.month]: revenue.bits.total })
                          .sort()
                          .slice(-13),
                      ),
                    }
                  : {}),
              }
            : {}),
          catalogStatus:
            p === 'Kick'
              ? 'unsupported'
              : warnings.some(v => ['videos', 'clips'].includes(v.section))
                ? 'partial'
                : 'complete',
        });
        for (const row of contents) {
          const old = s.contents.find(v => v.workspaceId === w && v.id === row.id);
          if (old) Object.assign(old, row);
          else s.contents.push(row);
        }
        s.streamSnapshots ??= [];
        s.streamSnapshots = s.streamSnapshots.filter(v => Date.parse(v.observedAt) > Date.now() - 90 * 86400000);
        s.streamSnapshots.push({ workspaceId: w, channelId: id, observedAt, followers, paidSubscribers, ...live });
        const grant = s.connections.find(v => v.id === connection.id);
        if (grant) Object.assign(grant, { status: 'connected', lastSyncedAt: observedAt, lastError: null });
      });
      return {
        channelId: id,
        imported: contents.length,
        complete: !warnings.some(v => ['videos', 'clips'].includes(v.section)),
        warnings,
        lastSyncedAt: observedAt,
      };
    } catch (e) {
      await repository.update(s => {
        const c = s.connections.find(c => c.id === connection.id);
        if (c)
          Object.assign(c, {
            lastError: e.message,
            ...(e.code === 'PROVIDER_REAUTHORIZE' ? { status: 'reauthorization_required' } : {}),
          });
      });
      throw e;
    } finally {
      locks.delete(connection.id);
    }
  }
  async function validateAll() {
    for (const c of repository.snapshot().connections.filter(c => c.platform === 'Twitch')) {
      if (locks.has(c.id) || !settings('Twitch').clientId) continue;
      locks.add(c.id);
      try {
        await credentials(c);
      } catch (e) {
        await repository.update(s => {
          const grant = s.connections.find(v => v.id === c.id);
          if (grant)
            Object.assign(grant, {
              lastError: e.message,
              ...(e.code === 'PROVIDER_REAUTHORIZE' ? { status: 'reauthorization_required' } : {}),
            });
        });
      } finally {
        locks.delete(c.id);
      }
    }
  }
  return {
    sync,
    /** Helix call with a connection's own (refreshed) token: GET with `params`, POST when `body` is given. */
    async helix(connection, path, { params = {}, body } = {}) {
      return api(connection.platform, await credentials(connection), path, params, body);
    },
    configured: p => Boolean(settings(p).clientId && settings(p).clientSecret),
    async initialize() {
      await validateAll();
      validationTimer = setInterval(() => void validateAll(), 3500000);
      validationTimer.unref();
    },
    stop() {
      clearInterval(validationTimer);
    },
    status(w) {
      return {
        providers: Object.keys(definitions).map(p => {
          const c = settings(p);
          return {
            platform: p,
            configured: Boolean(c.clientId && c.clientSecret),
            redirectUri: c.redirectUri,
            scopes: c.scopes,
            capabilities: { catalog: p === 'Twitch', live: true, analytics: false, revenue: false, comments: false },
          };
        }),
        items: repository
          .read()
          .connections.filter(c => c.workspaceId === w && definitions[c.platform])
          .map(safe),
      };
    },
    authorize(w, p, loginId = null, completionId = null) {
      config(p);
      if (!loginId && !repository.snapshot().workspaces.some(v => v.id === w))
        fail(400, 'INVALID_WORKSPACE', 'Use o workspace real.');
      prune();
      if (tickets.size >= 100) fail(429, 'TOO_MANY_ATTEMPTS', 'Aguarde antes de tentar novamente.');
      const ticket = random();
      tickets.set(ticket, { w, p, loginId, completionId, expires: Date.now() + 60000 });
      return {
        authorizationUrl: new URL(
          '/api/v1/oauth/' + p.toLowerCase() + '/start?ticket=' + ticket,
          settings(p).redirectUri,
        ).href,
      };
    },
    start(p, ticket) {
      config(p);
      prune();
      const entry = tickets.get(ticket);
      tickets.delete(ticket);
      if (!entry || entry.p !== p) fail(400, 'INVALID_OAUTH_TICKET', 'Inicie novamente a conexão pelo painel.');
      const state = random(),
        verifier = random(),
        c = settings(p);
      states.set(state, { ...entry, verifier, expires: Date.now() + 600000 });
      const params = new URLSearchParams({
        client_id: c.clientId,
        redirect_uri: c.redirectUri,
        response_type: 'code',
        scope: c.scopes.join(' '),
        state,
        ...(p === 'Kick'
          ? { code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }
          : { force_verify: 'true' }),
      });
      return {
        url: c.host + '/authorize?' + params,
        cookie: `serial_${p.toLowerCase()}_oauth=${state}; HttpOnly; SameSite=Lax; Path=/api/v1/oauth/${p.toLowerCase()}; Max-Age=600${c.redirectUri.startsWith('https:') ? '; Secure' : ''}`,
      };
    },
    async callback(p, params, cookie = '') {
      prune();
      const state = params.get('state'),
        entry = states.get(state);
      states.delete(state);
      const browser = cookie
        .split(';')
        .map(v => v.trim())
        .find(v => v.startsWith('serial_' + p.toLowerCase() + '_oauth='))
        ?.split('=')[1];
      if (!entry || entry.p !== p || browser !== state)
        fail(400, 'INVALID_OAUTH_STATE', 'A sessão de autorização expirou. Inicie novamente.');
      try {
        if (params.get('error')) {
          if (entry.loginId || entry.completionId) auth?.reject(entry.loginId || entry.completionId);
          return { location: oauthReturn(dashboardUrl, p.toLowerCase(), 'cancelled') };
        }
        if (!params.get('code')) fail(400, 'MISSING_CODE', 'Código de autorização ausente.');
        const tokens = await exchange(p, {
            grant_type: 'authorization_code',
            code: params.get('code'),
            redirect_uri: settings(p).redirectUri,
            ...(p === 'Kick' ? { code_verifier: entry.verifier } : {}),
          }),
          info = await profile(p, tokens.access_token);
        if (auth) entry.w = await auth.identify(entry.loginId, entry.w, p, [info.externalId], entry.completionId);
        const known = repository
          .read()
          .channels.find(c => c.workspaceId === entry.w && c.platform === p && c.externalId === info.externalId);
        const prefix = entry.w === 'studio-live' ? '' : entry.w + '-',
          channelId = known?.id ?? prefix + p.toLowerCase() + '-' + info.externalId,
          id = known?.connectionId ?? prefix + p.toLowerCase() + '-grant-' + info.externalId;
        if (p === 'Twitch') {
          const v = await json('https://id.twitch.tv/oauth2/validate', {
            headers: { Authorization: 'OAuth ' + tokens.access_token },
          });
          if (v.client_id !== settings(p).clientId || v.user_id !== info.externalId)
            fail(401, 'PROVIDER_REAUTHORIZE', 'Autorização Twitch inválida.');
        }
        await repository.update(s => {
          if (!s.workspaces.some(w => w.id === entry.w))
            fail(410, 'WORKSPACE_DELETED', 'Estúdio excluído. Inicie novamente.');
          if (s.workspaces.find(w => w.id === entry.w)?.mergedInto)
            fail(409, 'WORKSPACE_MERGED', 'O estúdio foi unido. Inicie novamente.');
          const previous = s.connections.find(c => c.id === id);
          const scopes = Array.isArray(tokens.scope)
            ? tokens.scope
            : String(tokens.scope ?? settings(p).scopes.join(' ')).split(' ');
          const grant = {
            id,
            workspaceId: entry.w,
            platform: p,
            status: 'connected',
            scopes,
            channelIds: [channelId],
            encryptedTokens: vault.seal({
              ...tokens,
              refresh_token:
                tokens.refresh_token ?? (previous ? vault.open(previous.encryptedTokens).refresh_token : undefined),
            }),
            createdAt: previous?.createdAt ?? new Date().toISOString(),
            validatedAt: p === 'Twitch' ? new Date().toISOString() : null,
          };
          if (previous) Object.assign(previous, grant);
          else s.connections.push(grant);
          const old = s.channels.find(c => c.id === channelId);
          const row = {
            ...info,
            profileFetchedAt: new Date().toISOString(),
            id: channelId,
            workspaceId: entry.w,
            connectionId: id,
            platform: p,
            dataSource: p.toLowerCase(),
            subscribers: null,
            lastSyncedAt: old?.lastSyncedAt ?? null,
          };
          if (old) Object.assign(old, row);
          else s.channels.push(row);
        });
        auth?.complete(entry.loginId, entry.w);
        auth?.complete(entry.completionId, entry.w);
        return {
          workspaceId: entry.w,
          mergePending: auth?.needsMerge(entry.completionId) ?? false,
          location: oauthReturn(
            entry.loginId || entry.completionId ? 'desktop' : dashboardUrl,
            p.toLowerCase(),
            'connected',
          ),
        };
      } catch (e) {
        if (entry.loginId || entry.completionId) auth?.reject(entry.loginId || entry.completionId);
        throw e;
      }
    },
    busyWorkspace(w) {
      return repository.snapshot().connections.some(c => c.workspaceId === w && locks.has(c.id));
    },
    async disconnect(w, id) {
      const c = repository
        .snapshot()
        .connections.find(c => c.workspaceId === w && c.id === id && definitions[c.platform]);
      if (!c) fail(404, 'CONNECTION_NOT_FOUND', 'Conexão não encontrada.');
      if (locks.has(c.id)) fail(409, 'SYNC_IN_PROGRESS', 'Aguarde a coleta terminar.');
      await repository.update(s => {
        s.connections = s.connections.filter(v => v.id !== id);
        const ids = new Set(c.channelIds);
        for (const k of [
          'channels',
          'contents',
          'comments',
          'reports',
          'videoReports',
          'playlists',
          'streamSnapshots',
          'streamEvents',
          'chatSessions',
        ])
          s[k] = (s[k] ?? []).filter(v => !(v.workspaceId === w && (ids.has(v.channelId) || ids.has(v.id))));
        detachPlanChannels(s, w, ids);
      });
    },
  };
}
