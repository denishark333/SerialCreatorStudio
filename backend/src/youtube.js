import { MEMBERS_SCOPE } from './memberships.js';
import { createLimiter } from './async.js';
import { readJsonSafely } from './http/provider.js';
import { oauthReturn } from './oauth-return.js';
import { OAuth2Client } from 'google-auth-library';
import { randomBytes, createHash } from 'node:crypto';
import { fail } from './errors.js';
export const LIVE_WORKSPACE = 'studio-live';
const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';
const COMMENTS_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const MONEY_SCOPE = 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly';
const READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const REQUIRED_YOUTUBE_SCOPES = [READ_SCOPE, ANALYTICS_SCOPE, MONEY_SCOPE, COMMENTS_SCOPE];
const random = () => randomBytes(32).toString('base64url');
const safeConnection = c => ({
  id: c.id,
  workspaceId: c.workspaceId,
  platform: c.platform,
  status: c.status,
  channelIds: c.channelIds,
  createdAt: c.createdAt,
  lastSyncedAt: c.lastSyncedAt ?? null,
  lastError: c.lastError ?? null,
  scopes: c.scopes,
  permissionsComplete: REQUIRED_YOUTUBE_SCOPES.every(scope => (c.scopes ?? []).includes(scope)),
  missingScopes: REQUIRED_YOUTUBE_SCOPES.filter(scope => !(c.scopes ?? []).includes(scope)),
});
function duration(value = 'PT0S') {
  const m = value.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return value;
  const hours = Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0),
    minutes = Number(m[3] ?? 0),
    seconds = Number(m[4] ?? 0);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
export function createYouTube({
  repository,
  vault,
  auth = null,
  clientId = '',
  clientSecret = '',
  redirectUri = 'http://localhost:4000/api/v1/oauth/google/callback',
  dashboardUrl = 'http://localhost:5173',
  fetcher = fetch,
  oauthFactory = () => new OAuth2Client(clientId, clientSecret, redirectUri),
  maxPages = 10,
  membershipsEnabled = false,
}) {
  const configured = Boolean(clientId && clientSecret && vault);
  const tickets = new Map(),
    states = new Map(),
    locks = new Set(),
    readers = new Map(),
    credentialTasks = new Map();
  const limitRequest = createLimiter(6);
  const now = () => Date.now();
  const prune = () => {
    for (const map of [tickets, states]) for (const [key, value] of map) if (value.expires < now()) map.delete(key);
  };
  function config() {
    if (!configured)
      fail(
        503,
        'YOUTUBE_NOT_CONFIGURED',
        'Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no backend/.env e reinicie o backend.',
      );
  }
  async function json(url, token, options = {}) {
    let response;
    try {
      response = await limitRequest(() =>
        fetcher(url, {
          method: options.method ?? 'GET',
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
          headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          signal: AbortSignal.timeout(20000),
        }),
      );
    } catch {
      fail(424, 'YOUTUBE_NETWORK_ERROR', 'YouTube network request failed. Try again.');
    }
    const payload = await readJsonSafely(response);
    if (!response.ok) {
      const raw = payload?.error?.errors?.[0]?.reason ?? payload?.error?.status ?? 'unknown';
      const reason = /^[a-zA-Z0-9_]{1,80}$/.test(raw) ? raw : 'unknown';
      const messages = {
        quotaExceeded: 'A quota do YouTube foi esgotada. Tente novamente mais tarde.',
        commentsDisabled: 'Os comentarios deste video estao desativados.',
        forbidden: 'O YouTube recusou a leitura destes comentários. A consulta por vídeo pode estar disponível.',
        insufficientPermissions: 'A autorização não inclui a permissão necessária. Reconecte o canal.',
        accessNotConfigured: 'Habilite a YouTube Data API v3 no projeto Google.',
        SERVICE_DISABLED: 'A API necessária está desativada no projeto Google.',
        channelNotFound: 'O canal solicitado não foi encontrado.',
        videoNotFound: 'O vídeo solicitado não foi encontrado.',
        invalidPageToken: 'A paginação expirou. Reinicie a coleta.',
        operationNotSupported:
          'O YouTube não permite esta ação neste comentário. Ele pode ter sido excluído ou estar oculto no YouTube.',
      };
      const code =
        response.status === 401
          ? 'YOUTUBE_REAUTHORIZE'
          : reason === 'commentsDisabled'
            ? 'YOUTUBE_COMMENTS_DISABLED'
            : 'YOUTUBE_API_ERROR';
      fail(
        response.status === 401 ? 401 : 424,
        code,
        (messages[reason] ?? 'O YouTube recusou a consulta.') + ' [' + reason + ']',
        { providerStatus: response.status, reason },
      );
    }
    if (payload === null) {
      fail(424, 'YOUTUBE_INVALID_RESPONSE', 'O YouTube retornou uma resposta inválida. Tente novamente.', {
        providerStatus: response.status,
      });
    }
    return payload;
  }

  const api = (resource, params, token) =>
    json('https://www.googleapis.com/youtube/v3/' + resource + '?' + new URLSearchParams(params), token);
  async function loadCredentials(connection) {
    const oauth = oauthFactory();
    oauth.setCredentials(vault.open(connection.encryptedTokens));
    oauth.on?.('tokens', () => {});
    let access;
    try {
      access = await oauth.getAccessToken();
    } catch {
      await repository.update(s => {
        const c = s.connections.find(c => c.id === connection.id);
        if (c) c.status = 'reauthorization_required';
      });
      fail(401, 'YOUTUBE_REAUTHORIZE', 'A autorização expirou ou foi revogada. Reconecte o canal.');
    }
    if (!access.token) fail(401, 'YOUTUBE_REAUTHORIZE', 'Reconecte o canal para renovar a autorização.');
    await repository.update(s => {
      const c = s.connections.find(c => c.id === connection.id);
      if (c && JSON.stringify(c.encryptedTokens) === JSON.stringify(connection.encryptedTokens))
        c.encryptedTokens = vault.seal(oauth.credentials);
    });
    return access.token;
  }
  function credentials(connection) {
    if (credentialTasks.has(connection.id)) return credentialTasks.get(connection.id);
    const fresh = repository.snapshot().connections.find(c => c.id === connection.id) ?? connection;
    const task = loadCredentials(fresh).finally(() => credentialTasks.delete(connection.id));
    credentialTasks.set(connection.id, task);
    return task;
  }
  async function discover(workspaceId, tokens, loginId, completionId) {
    const data = await api(
      'channels',
      { part: 'snippet,statistics,contentDetails', mine: 'true', maxResults: '50' },
      tokens.access_token,
    );
    if (!data.items?.length)
      fail(
        422,
        'NO_YOUTUBE_CHANNEL',
        'Nenhum canal foi encontrado nesta autorização. Selecione a conta ou canal correto.',
      );
    const scope = tokens.scope ?? '';
    if (!scope.split(' ').includes(READ_SCOPE))
      fail(403, 'MISSING_YOUTUBE_SCOPE', 'Autorize a leitura do canal do YouTube.');
    if (auth)
      workspaceId = await auth.identify(
        loginId,
        workspaceId,
        'YouTube',
        data.items.map(c => c.id),
        completionId,
      );
    const result = await repository.update(s => {
      if (s.workspaces.find(w => w.id === workspaceId)?.mergedInto)
        fail(409, 'WORKSPACE_MERGED', 'O estúdio foi unido. Inicie novamente.');
      s.connections ??= [];
      if (!s.workspaces.some(w => w.id === workspaceId))
        fail(410, 'WORKSPACE_DELETED', 'Estúdio excluído. Inicie novamente.');
      const channelIds = [];
      const created = new Date().toISOString();
      // A grant is scoped to the selected YouTube channel; reconnect replaces that grant only.
      const known = s.channels.find(
        c =>
          c.workspaceId === workspaceId &&
          c.platform === 'YouTube' &&
          data.items.some(item => item.id === c.externalId),
      );
      const id =
        known?.connectionId ??
        'google-' +
          workspaceId +
          '-' +
          data.items
            .map(c => c.id)
            .sort()
            .join('-');
      const previous = s.connections.find(c => c.id === id);
      let saved = { ...tokens };
      if (!saved.refresh_token && previous) saved.refresh_token = vault.open(previous.encryptedTokens).refresh_token;
      const connection = {
        id,
        workspaceId,
        platform: 'YouTube',
        status: 'connected',
        channelIds,
        scopes: scope.split(' '),
        encryptedTokens: vault.seal(saved),
        createdAt: previous?.createdAt ?? created,
      };
      for (const item of data.items) {
        const channelId = 'yt-' + item.id;
        channelIds.push(channelId);
        const old = s.channels.find(c => c.workspaceId === workspaceId && c.id === channelId);
        const row = {
          ...old,
          id: channelId,
          workspaceId,
          platform: 'YouTube',
          name: item.snippet.title,
          profileFetchedAt: created,
          externalId: item.id,
          connectionId: id,
          uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads,
          subscribers: item.statistics?.hiddenSubscriberCount ? null : Number(item.statistics?.subscriberCount ?? 0),
          thumbnailUrl: item.snippet.thumbnails?.default?.url ?? null,
          lastSyncedAt: old?.lastSyncedAt ?? null,
          dataSource: 'youtube',
        };
        if (old) Object.assign(old, row);
        else s.channels.push(row);
      }
      if (previous) Object.assign(previous, connection);
      else s.connections.push(connection);
      return safeConnection(connection);
    });
    auth?.complete(loginId, workspaceId);
    return result;
  }
  async function sync(workspaceId, channelId) {
    config();
    const initial = repository.snapshot();
    const channel = initial.channels.find(
      c => c.workspaceId === workspaceId && c.id === channelId && c.dataSource === 'youtube',
    );
    if (!channel) fail(404, 'CHANNEL_NOT_FOUND', 'Canal real do YouTube não encontrado.');
    const connection = initial.connections?.find(c => c.workspaceId === workspaceId && c.id === channel.connectionId);
    if (!connection) fail(404, 'CONNECTION_NOT_FOUND', 'Conexão não encontrada.');
    if (locks.has(connection.id) || readers.get(connection.id))
      fail(409, 'SYNC_IN_PROGRESS', 'Há uma sincronização em andamento para esta conexão.');
    locks.add(connection.id);
    try {
      const token = await credentials(connection);
      let pageToken = channel.nextPageToken ?? '',
        pages = 0,
        imported = 0,
        finished = false;
      const observedAt = new Date().toISOString();
      while (pages < maxPages) {
        const params = {
          part: 'contentDetails',
          playlistId: channel.uploadsPlaylistId,
          maxResults: '50',
          ...(pageToken ? { pageToken } : {}),
        };
        const playlist = await api('playlistItems', params, token);
        const ids = (playlist.items ?? []).map(i => i.contentDetails?.videoId).filter(Boolean);
        let videos = [];
        if (ids.length)
          videos =
            (
              await api(
                'videos',
                { part: 'snippet,statistics,contentDetails,status,liveStreamingDetails', id: ids.join(',') },
                token,
              )
            ).items ?? [];
        await repository.update(s => {
          for (const v of videos) {
            const id = 'yt-video-' + v.id;
            const existing = s.contents.find(c => c.workspaceId === workspaceId && c.id === id);
            const thumbnail =
              v.snippet.thumbnails?.maxres?.url ??
              v.snippet.thumbnails?.high?.url ??
              v.snippet.thumbnails?.default?.url ??
              '';
            const row = {
              id,
              workspaceId,
              channelId,
              externalId: v.id,
              platform: 'YouTube',
              title: v.snippet.title,
              tags: v.snippet.tags ?? [],
              description: v.snippet.description ?? '',
              date: v.snippet.publishedAt.slice(0, 10),
              publishedAt: v.snippet.publishedAt,
              duration: duration(v.contentDetails?.duration),
              format: v.liveStreamingDetails ? (v.liveStreamingDetails.actualEndTime ? 'VOD' : 'Live') : 'Vídeo',
              formatClassification: v.liveStreamingDetails ? 'live_metadata' : 'shorts_unclassified',
              status:
                { public: 'Público', private: 'Privado', unlisted: 'Não listado' }[v.status?.privacyStatus] ??
                'Desconhecido',
              views: v.statistics?.viewCount === undefined ? null : Number(v.statistics.viewCount),
              likes: v.statistics?.likeCount === undefined ? null : Number(v.statistics.likeCount),
              comments: v.statistics?.commentCount === undefined ? null : Number(v.statistics.commentCount),
              retention: null,
              image: '',
              thumbnailUrl: thumbnail,
              watchUrl: 'https://www.youtube.com/watch?v=' + v.id,
              dataSource: 'youtube',
              lastSyncedAt: observedAt,
            };
            if (existing) {
              if (['manual', 'youtube_analytics'].includes(existing.formatClassification)) {
                row.format = existing.format;
                row.formatClassification = existing.formatClassification;
              }
              Object.assign(existing, row);
            } else s.contents.push(row);
          }
          const c = s.channels.find(c => c.workspaceId === workspaceId && c.id === channelId);
          c.nextPageToken = playlist.nextPageToken ?? null;
          c.catalogStatus = playlist.nextPageToken ? 'partial' : 'complete';
          c.lastSyncedAt = observedAt;
        });
        imported += videos.length;
        pages++;
        pageToken = playlist.nextPageToken;
        if (!pageToken) {
          finished = true;
          break;
        }
      }
      await repository.update(s => {
        const c = s.connections.find(c => c.id === connection.id);
        c.status = 'connected';
        c.lastSyncedAt = observedAt;
        c.lastError = null;
      });
      return { channelId, imported, pages, complete: finished, lastSyncedAt: observedAt };
    } catch (e) {
      await repository.update(s => {
        const c = s.connections.find(c => c.id === connection.id);
        if (c) c.lastError = e.code ?? 'SYNC_FAILED';
      });
      throw e;
    } finally {
      locks.delete(connection.id);
    }
  }
  return {
    configured,
    async runChannelTask(workspaceId, channelId, task, { readOnly = false } = {}) {
      config();
      const state = repository.snapshot();
      const channel = state.channels.find(
        c => c.workspaceId === workspaceId && c.id === channelId && c.dataSource === 'youtube',
      );
      if (!channel) fail(404, 'CHANNEL_NOT_FOUND', 'YouTube channel not found in workspace.');
      const connection = state.connections?.find(c => c.workspaceId === workspaceId && c.id === channel.connectionId);
      if (!connection) fail(404, 'CONNECTION_NOT_FOUND', 'Connection not found.');
      if (locks.has(connection.id) || (!readOnly && readers.get(connection.id)))
        fail(409, 'SYNC_IN_PROGRESS', 'A sync is already running for this connection.');
      if (readOnly) readers.set(connection.id, (readers.get(connection.id) ?? 0) + 1);
      else locks.add(connection.id);
      try {
        const token = await credentials(connection);
        return await task({
          channel,
          scopes: connection.scopes ?? [],
          data: (resource, params) => api(resource, params, token),
          moderateComment: (commentId, status) =>
            json(
              'https://www.googleapis.com/youtube/v3/comments/setModerationStatus?' +
                new URLSearchParams({ id: commentId, moderationStatus: status, banAuthor: 'false' }),
              token,
              { method: 'POST' },
            ),
          publishReply: (parentId, text) =>
            json('https://www.googleapis.com/youtube/v3/comments?part=snippet', token, {
              method: 'POST',
              body: { snippet: { parentId, textOriginal: text } },
            }),
          report: params =>
            json(
              'https://youtubeanalytics.googleapis.com/v2/reports?' +
                new URLSearchParams({ ...params, ids: 'channel==' + channel.externalId }),
              token,
            ),
        });
      } finally {
        if (readOnly) {
          const count = (readers.get(connection.id) ?? 1) - 1;
          if (count) readers.set(connection.id, count);
          else readers.delete(connection.id);
        } else locks.delete(connection.id);
      }
    },
    busyWorkspace(w) {
      return repository
        .read()
        .connections.some(
          c => c.workspaceId === w && (locks.has(c.id) || readers.get(c.id) || credentialTasks.has(c.id)),
        );
    },
    status(workspaceId) {
      return {
        configured,
        redirectUri,
        items: (repository.snapshot().connections ?? [])
          .filter(c => c.workspaceId === workspaceId && c.platform === 'YouTube')
          .map(safeConnection),
        providers: [
          {
            platform: 'YouTube',
            status: configured ? 'available' : 'not_configured',
            oauth: configured,
            catalog: configured,
            analytics: configured,
            revenue: configured,
            management: false,
            reason:
              'Catálogo e relatórios disponíveis conforme os escopos concedidos; receitas exigem permissão adicional.',
          },
        ],
      };
    },
    authorize(workspaceId, loginId = null, completionId = null) {
      config();
      if (
        !loginId &&
        workspaceId !== LIVE_WORKSPACE &&
        !repository.snapshot().workspaces.some(w => w.id === workspaceId)
      )
        fail(404, 'WORKSPACE_NOT_FOUND', 'Workspace não encontrado.');
      prune();
      if (tickets.size >= 100) fail(429, 'TOO_MANY_ATTEMPTS', 'Aguarde antes de tentar novamente.');
      const ticket = random();
      tickets.set(ticket, {
        workspaceId,
        loginId,
        completionId,
        scopes: [...REQUIRED_YOUTUBE_SCOPES, ...(membershipsEnabled ? [MEMBERS_SCOPE] : [])],
        expires: now() + 60000,
      });
      const start = new URL('/api/v1/oauth/google/start', redirectUri);
      start.searchParams.set('ticket', ticket);
      return { authorizationUrl: start.href };
    },
    async start(ticket) {
      config();
      prune();
      const entry = tickets.get(ticket);
      tickets.delete(ticket);
      if (!entry) fail(400, 'INVALID_OAUTH_TICKET', 'A tentativa expirou. Inicie novamente pela dashboard.');
      const state = random(),
        binding = random(),
        verifier = randomBytes(64).toString('base64url');
      states.set(state, { ...entry, binding, verifier, expires: now() + 600000 });
      const oauth = oauthFactory();
      const url = oauth.generateAuthUrl({
        access_type: 'offline',
        include_granted_scopes: true,
        prompt: 'consent select_account',
        scope: entry.scopes,
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      });
      return {
        url,
        cookie: `serial_google_oauth=${binding}; HttpOnly; SameSite=Lax; Path=/api/v1/oauth/google; Max-Age=600${redirectUri.startsWith('https:') ? '; Secure' : ''}`,
      };
    },
    async callback(params, cookie) {
      config();
      prune();
      const state = params.get('state');
      const entry = states.get(state);
      const binding = cookie
        ?.split(';')
        .map(v => v.trim())
        .find(v => v.startsWith('serial_google_oauth='))
        ?.slice('serial_google_oauth='.length);
      if (!entry || !binding || binding !== entry.binding)
        fail(400, 'INVALID_OAUTH_STATE', 'Tentativa inválida ou expirada. Inicie novamente pela dashboard.');
      states.delete(state);
      if (params.has('error')) {
        if (entry.loginId || entry.completionId) auth?.reject(entry.loginId || entry.completionId);
        return { location: oauthReturn(dashboardUrl, 'youtube', 'cancelled') };
      }
      const code = params.get('code');
      if (!code) fail(400, 'MISSING_OAUTH_CODE', 'Código de autorização ausente.');
      const oauth = oauthFactory();
      let tokens;
      try {
        ({ tokens } = await oauth.getToken({ code, codeVerifier: entry.verifier, redirect_uri: redirectUri }));
      } catch {
        if (entry.loginId || entry.completionId) auth?.reject(entry.loginId || entry.completionId);
        fail(
          424,
          'GOOGLE_TOKEN_EXCHANGE_FAILED',
          'Falha na autorização. Verifique o callback e as credenciais do backend e tente novamente.',
        );
      }
      let connection;
      try {
        connection = await discover(entry.workspaceId, tokens, entry.loginId, entry.completionId);
      } catch (e) {
        if (entry.loginId || entry.completionId) auth?.reject(entry.loginId || entry.completionId);
        throw e;
      }
      auth?.complete(entry.completionId, connection.workspaceId);
      return {
        workspaceId: connection.workspaceId,
        mergePending: auth?.needsMerge(entry.completionId) ?? false,
        location: oauthReturn(entry.loginId || entry.completionId ? 'desktop' : dashboardUrl, 'youtube', 'connected'),
      };
    },
    sync,
    async disconnect(workspaceId, id) {
      const c = repository.snapshot().connections?.find(c => c.workspaceId === workspaceId && c.id === id);
      if (!c) fail(404, 'CONNECTION_NOT_FOUND', 'Conexão não encontrada.');
      if (locks.has(id) || readers.get(id)) fail(409, 'SYNC_IN_PROGRESS', 'Aguarde o fim da sincronização.');
      await repository.update(s => {
        s.connections = s.connections.filter(c => c.id !== id);
        const ids = new Set(c.channelIds);
        s.channels = s.channels.filter(c => !(c.workspaceId === workspaceId && ids.has(c.id)));
        s.contents = s.contents.filter(c => !(c.workspaceId === workspaceId && ids.has(c.channelId)));
        s.metrics = s.metrics.filter(c => !(c.workspaceId === workspaceId && ids.has(c.channelId)));
        s.reports = (s.reports ?? []).filter(c => !(c.workspaceId === workspaceId && ids.has(c.channelId)));
        s.comments = s.comments.filter(c => !(c.workspaceId === workspaceId && ids.has(c.channelId)));
        s.videoReports = (s.videoReports ?? []).filter(
          c =>
            !(
              c.workspaceId === workspaceId &&
              c.contentId.startsWith('yt-video-') &&
              !s.contents.some(v => v.workspaceId === workspaceId && v.id === c.contentId)
            ),
        );
        s.membershipSnapshots = (s.membershipSnapshots ?? []).filter(
          v => !(v.workspaceId === workspaceId && ids.has(v.channelId)),
        );
        s.playlists = (s.playlists ?? []).filter(c => !(c.workspaceId === workspaceId && ids.has(c.channelId)));
      });
      return null;
    },
  };
}
