import { membershipFor } from './memberships.js';
import { randomUUID } from 'node:crypto';
import { fail, text, objectBody, dateOnly, member } from './errors.js';
import { period } from './reports.js';
const unpack = r =>
  (r.rows ?? []).map(row => Object.fromEntries((r.columnHeaders ?? []).map((h, i) => [h.name, row[i]])));
/** Metrics a goal can track (the first one is the default, kept as `workspace.subscriberGoal`). */
const GOAL_METRICS = [
  'youtube.subscribers',
  'twitch.followers',
  'twitch.subscribers',
  'kick.followers',
  'kick.subscribers',
];
/**
 * Delivery of a brand deal: its window (`date` → `endDate`, one day when absent) and the keywords that recognise
 * the content delivering it (title, tags or game). `existing` is the stored deal on PATCH.
 */
function dealDelivery(body, date, existing) {
  const out = {};
  if (body.endDate !== undefined) {
    if (body.endDate === null) out.endDate = null;
    else {
      out.endDate = dateOnly(body.endDate, 'endDate');
      if (out.endDate < date) fail(400, 'INVALID_RANGE', 'O fim da parceria deve ser igual ou posterior ao início.');
    }
  } else if (!existing) out.endDate = null;
  if (body.keywords !== undefined) {
    const list = body.keywords;
    if (
      !Array.isArray(list) ||
      list.length > 10 ||
      list.some(k => typeof k !== 'string' || !k.trim() || k.trim().length > 60)
    )
      fail(400, 'INVALID_FIELD', 'keywords deve listar até 10 palavras-chave de 1 a 60 caracteres.');
    out.keywords = [...new Set(list.map(k => k.trim()))];
  } else if (!existing) out.keywords = [];
  return out;
}
export function createStudio({ repository, youtube }) {
  const replyLocks = new Set();
  function state(w) {
    const s = repository.snapshot();
    if (!s.workspaces.some(x => x.id === w)) fail(404, 'WORKSPACE_NOT_FOUND', 'Workspace não encontrado.');
    return s;
  }
  function content(w, id) {
    const c = state(w).contents.find(c => c.workspaceId === w && c.id === id);
    if (!c) fail(404, 'CONTENT_NOT_FOUND', 'Conteúdo não encontrado.');
    return c;
  }
  function scoped(w, collection, id) {
    const value = (state(w)[collection] ?? []).find(v => v.workspaceId === w && v.id === id);
    if (!value) fail(404, 'NOT_FOUND', 'Registro não encontrado.');
    return value;
  }
  function selected(w, p, collection) {
    const s = state(w),
      ids = p.getAll('channelId');
    for (const id of ids)
      if (!s.channels.some(c => c.workspaceId === w && c.id === id))
        fail(404, 'CHANNEL_NOT_FOUND', 'Canal não encontrado.');
    return (s[collection] ?? []).filter(v => v.workspaceId === w && (!ids.length || ids.includes(v.channelId)));
  }
  async function optional(provider, params) {
    try {
      const raw = await provider.report(params);
      return { status: raw.rows?.length ? 'available' : 'no_data', rows: unpack(raw), reason: null };
    } catch (e) {
      return { status: 'unavailable', rows: [], reason: e.message };
    }
  }
  function details(w, id, p) {
    const c = content(w, id),
      range = period(p),
      s = state(w);
    const saved = (s.videoReports ?? []).find(
      r => r.workspaceId === w && r.contentId === id && r.from === range.from && r.to === range.to,
    );
    const bundle = (s.reports ?? []).find(
      r => r.workspaceId === w && r.channelId === c.channelId && r.from === range.from && r.to === range.to,
    );
    const summary = saved?.summary?.rows?.[0];
    const ranked = bundle?.top?.rows?.find(r => r.video === c.externalId);
    return {
      ...c,
      period: range,
      summary: summary ?? ranked ?? null,
      report: saved ?? null,
      syncStatus: c.platform !== 'YouTube' ? 'unsupported' : saved ? 'cached' : 'pending_global_sync',
      capabilities: {
        edit: false,
        reason:
          c.platform === 'YouTube'
            ? 'Edição disponível no YouTube Studio.'
            : 'Edição disponível na plataforma de origem.',
      },
    };
  }
  async function syncVideo(w, id, p) {
    const c = content(w, id),
      range = period(p);
    return youtube.runChannelTask(
      w,
      c.channelId,
      async provider => {
        const base = {
          ids: 'channel==' + provider.channel.externalId,
          startDate: range.from,
          endDate: range.to,
          filters: 'video==' + c.externalId,
        };
        const [summary, daily, retention, traffic, revenue] = await Promise.all([
          optional(provider, {
            ...base,
            metrics: 'views,estimatedMinutesWatched,averageViewPercentage,averageViewDuration,likes,comments,shares',
          }),
          optional(provider, { ...base, dimensions: 'day', metrics: 'views', sort: 'day', maxResults: '1000' }),
          optional(provider, {
            ...base,
            dimensions: 'elapsedVideoTimeRatio',
            metrics: 'audienceWatchRatio',
            sort: 'elapsedVideoTimeRatio',
          }),
          optional(provider, { ...base, dimensions: 'insightTrafficSourceType', metrics: 'views', sort: '-views' }),
          provider.scopes.includes('https://www.googleapis.com/auth/yt-analytics-monetary.readonly')
            ? optional(provider, { ...base, metrics: 'estimatedRevenue', currency: 'USD' })
            : { status: 'permission_required', rows: [], reason: 'Atualize a conexão do canal.' },
        ]);
        const report = {
          workspaceId: w,
          contentId: id,
          ...range,
          summary,
          daily,
          retention,
          traffic,
          revenue,
          fetchedAt: new Date().toISOString(),
        };
        await repository.update(s => {
          s.videoReports ??= [];
          const old = s.videoReports.find(
            r => r.workspaceId === w && r.contentId === id && r.from === range.from && r.to === range.to,
          );
          if (old) Object.assign(old, report);
          else s.videoReports.push(report);
        });
        return report;
      },
      { readOnly: true },
    );
  }
  async function classify(w, id, p) {
    const imported = state(w).contents.filter(c => c.workspaceId === w && c.channelId === id);
    const requested = period(p);
    const range = {
      from:
        imported
          .map(c => c.date)
          .filter(Boolean)
          .sort()[0] ?? requested.from,
      to: new Date().toISOString().slice(0, 10),
    };
    return youtube.runChannelTask(
      w,
      id,
      async provider => {
        let updated = 0,
          unresolved = 0;
        for (let offset = 0; offset < imported.length; offset += 100) {
          const chunk = imported.slice(offset, offset + 100);
          const result = await provider.report({
            startDate: range.from,
            endDate: range.to,
            dimensions: 'video,creatorContentType',
            metrics: 'views',
            filters: 'video==' + chunk.map(c => c.externalId).join(','),
            sort: '-views',
            maxResults: '200',
          });
          const evidence = unpack(result);
          await repository.update(s => {
            for (const r of evidence) {
              const c = s.contents.find(c => c.workspaceId === w && c.channelId === id && c.externalId === r.video);
              if (!c) continue;
              const format = { SHORTS: 'Short', VIDEO_ON_DEMAND: 'Vídeo', LIVE_STREAM: 'VOD' }[
                String(r.creatorContentType).toUpperCase()
              ];
              if (format) {
                c.format = format;
                c.formatClassification = 'youtube_analytics';
                c.formatIdentifiedAt = new Date().toISOString();
                updated++;
              }
            }
          });
          const found = new Set(evidence.map(r => r.video));
          unresolved += chunk.filter(c => !found.has(c.externalId)).length;
        }
        return { updated, unresolved, period: range, source: 'youtube_analytics_lifetime' };
      },
      { readOnly: true },
    );
  }

  async function syncPlaylists(w, id) {
    return youtube.runChannelTask(
      w,
      id,
      async provider => {
        const response = await provider.data('playlists', {
          part: 'snippet,contentDetails,status',
          mine: 'true',
          maxResults: '10',
          ...(provider.channel.playlistsNextPageToken ? { pageToken: provider.channel.playlistsNextPageToken } : {}),
        });
        for (const item of response.items ?? []) {
          const result = await provider.data('playlistItems', {
            part: 'snippet,contentDetails',
            playlistId: item.id,
            maxResults: '50',
          });
          await repository.update(s => {
            s.playlists ??= [];
            const row = {
              id: 'yt-playlist-' + item.id,
              externalId: item.id,
              workspaceId: w,
              channelId: id,
              title: item.snippet.title,
              description: item.snippet.description ?? '',
              thumbnailUrl: item.snippet.thumbnails?.high?.url ?? '',
              itemCount: item.contentDetails.itemCount,
              status: item.status?.privacyStatus,
              items: (result.items ?? []).map(i => ({
                id: i.id,
                videoId: i.contentDetails.videoId,
                title: i.snippet.title,
                position: i.snippet.position,
                thumbnailUrl: i.snippet.thumbnails?.medium?.url ?? '',
              })),
              nextPageToken: result.nextPageToken ?? null,
              lastSyncedAt: new Date().toISOString(),
            };
            const old = s.playlists.find(v => v.workspaceId === w && v.id === row.id);
            if (old) Object.assign(old, row);
            else s.playlists.push(row);
          });
        }
        await repository.update(s => {
          const c = s.channels.find(c => c.workspaceId === w && c.id === id);
          c.playlistsNextPageToken = response.nextPageToken ?? null;
        });
        return { imported: response.items?.length ?? 0, complete: !response.nextPageToken };
      },
      { readOnly: true },
    );
  }
  async function morePlaylist(w, id) {
    const pl = scoped(w, 'playlists', id);
    if (!pl.nextPageToken) return pl;
    return youtube.runChannelTask(
      w,
      pl.channelId,
      async provider => {
        const result = await provider.data('playlistItems', {
          part: 'snippet,contentDetails',
          playlistId: pl.externalId,
          maxResults: '50',
          pageToken: pl.nextPageToken,
        });
        return repository.update(s => {
          const target = s.playlists.find(v => v.workspaceId === w && v.id === id);
          for (const i of result.items ?? [])
            if (!target.items.some(v => v.id === i.id))
              target.items.push({
                id: i.id,
                videoId: i.contentDetails.videoId,
                title: i.snippet.title,
                position: i.snippet.position,
                thumbnailUrl: i.snippet.thumbnails?.medium?.url ?? '',
              });
          target.nextPageToken = result.nextPageToken ?? null;
          return target;
        });
      },
      { readOnly: true },
    );
  }
  function catalog(w, p) {
    const s = state(w),
      range = period(p),
      format = p.get('format'),
      q = (p.get('q') ?? '').toLocaleLowerCase('pt-BR');
    const items = selected(w, p, 'contents')
      .filter(
        c =>
          (!format || c.format === format) &&
          (p.get('kind') !== 'videos' || c.format !== 'Short') &&
          (!p.get('externalId') || c.externalId === p.get('externalId')) &&
          [c.title, ...(c.tags ?? [])].join(' ').toLocaleLowerCase('pt-BR').includes(q),
      )
      .map(c => {
        const bundle = (s.reports ?? []).find(
          r => r.workspaceId === w && r.channelId === c.channelId && r.from === range.from && r.to === range.to,
        );
        const r = bundle?.top?.rows?.find(v => v.video === c.externalId);
        const v = (s.videoReports ?? []).find(
          v => v.workspaceId === w && v.contentId === c.id && v.from === range.from && v.to === range.to,
        );
        return {
          ...c,
          periodViews: r?.views ?? v?.summary?.rows?.[0]?.views ?? null,
          averageViewPercentage: r?.averageViewPercentage ?? v?.summary?.rows?.[0]?.averageViewPercentage ?? null,
          estimatedRevenue: v?.revenue?.rows?.[0]?.estimatedRevenue ?? null,
          retentionCurve: v?.retention?.rows ?? null,
          dailyViews: v?.daily?.rows ?? null,
        };
      });
    const sort = p.get('sort') ?? 'date';
    return items.sort((a, b) =>
      sort === 'date'
        ? b.date.localeCompare(a.date)
        : ((sort === 'views' ? b.views : sort === 'retention' ? b.averageViewPercentage : b.estimatedRevenue) ?? -1) -
          ((sort === 'views' ? a.views : sort === 'retention' ? a.averageViewPercentage : a.estimatedRevenue) ?? -1),
    );
  }
  function comments(w, p) {
    const s = state(w),
      q = (p.get('q') ?? '').toLocaleLowerCase('pt-BR'),
      filter = p.get('filter') ?? 'all';
    return selected(w, p, 'comments')
      .map(c => {
        const video = s.contents.find(
          v => v.workspaceId === w && v.channelId === c.channelId && v.externalId === c.videoId,
        );
        return {
          ...c,
          membership: membershipFor(s, w, c.channelId, c.authorChannelId),
          video: video ? { id: video.id, title: video.title, thumbnailUrl: video.thumbnailUrl } : null,
        };
      })
      .filter(
        c =>
          // Main list: published only. "Ocultos": held for review (reversible). Deleted comments leave the store.
          (filter === 'hidden'
            ? c.youtubeModerationStatus === 'heldForReview'
            : !['heldForReview', 'rejected'].includes(c.youtubeModerationStatus)) &&
          (filter !== 'members' || c.membership.status === 'member') &&
          (filter !== 'questions' || c.text.includes('?')) &&
          (filter !== 'answered' || c.replies?.some(r => r.isOwner === true || r.delivery === 'published')) &&
          [c.text, c.author, c.video?.title].join(' ').toLocaleLowerCase('pt-BR').includes(q),
      )
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  }
  async function annotate(w, id, body) {
    scoped(w, 'comments', id);
    objectBody(body, ['localHearted', 'localPinned', 'localHidden']);
    if (!Object.keys(body).length) fail(400, 'EMPTY_PATCH', 'Selecione uma ação.');
    for (const v of Object.values(body))
      if (typeof v !== 'boolean') fail(400, 'INVALID_FIELD', 'A ação deve ser booleana.');
    return repository.update(s => {
      const c = s.comments.find(c => c.workspaceId === w && c.id === id);
      Object.assign(c, body);
      return c;
    });
  }
  async function reply(w, id, body) {
    const c = scoped(w, 'comments', id);
    objectBody(body, ['text', 'requestId']);
    const value = text(body.text, 'text', 5000),
      requestId = text(body.requestId, 'requestId', 100);
    if (c.youtubeModerationStatus === 'heldForReview')
      fail(409, 'COMMENT_HIDDEN', 'Este comentário está oculto. Republique-o antes de responder.');
    const prior = c.replies?.find(r => r.requestId === requestId);
    if (prior) {
      if (prior.text !== value) fail(409, 'REQUEST_ID_REUSED', 'Use um novo identificador para outra resposta.');
      return prior;
    }
    if (replyLocks.has(w + id)) fail(409, 'REPLY_IN_PROGRESS', 'Uma resposta está sendo enviada.');
    replyLocks.add(w + id);
    try {
      return await youtube.runChannelTask(w, c.channelId, async provider => {
        if (!provider.scopes.includes('https://www.googleapis.com/auth/youtube.force-ssl'))
          fail(403, 'COMMENTS_PERMISSION_REQUIRED', 'Atualize a conexão do canal.');
        const posted = await provider.publishReply(c.externalId, value);
        if (!posted.id) fail(424, 'INVALID_REPLY', 'O YouTube não confirmou a resposta.');
        const row = {
          id: posted.id,
          requestId,
          text: value,
          createdAt: new Date().toISOString(),
          delivery: 'published',
          isOwner: true,
          source: 'youtube',
        };
        await repository.update(s => {
          const target = s.comments.find(v => v.workspaceId === w && v.id === id);
          target.replies ??= [];
          target.replies.push(row);
          target.replyCount = (target.replyCount ?? 0) + 1;
        });
        return row;
      });
    } finally {
      replyLocks.delete(w + id);
    }
  }
  /**
   * YouTube moderation (comments.setModerationStatus):
   * - heldForReview: "Ocultar" — hidden from the public, listed in YouTube Studio > Comments > Held for review;
   *   reversible with published.
   * - published: "Republicar" — back on the video.
   * - rejected: "Excluir" — removed from the video together with its replies; YouTube Studio does not list it and
   *   it cannot be brought back, so the comment also leaves the local store.
   */
  async function moderate(w, id, body) {
    const c = scoped(w, 'comments', id);
    objectBody(body, ['status']);
    const status = member(body.status, ['heldForReview', 'published', 'rejected'], 'status');
    return youtube.runChannelTask(w, c.channelId, async provider => {
      if (!provider.scopes.includes('https://www.googleapis.com/auth/youtube.force-ssl'))
        fail(403, 'COMMENTS_PERMISSION_REQUIRED', 'Atualize a conexão do canal.');
      await provider.moderateComment(c.externalId, status);
      return repository.update(s => {
        if (status === 'rejected') {
          s.comments = s.comments.filter(v => !(v.workspaceId === w && v.id === id));
          return { id, youtubeModerationStatus: 'rejected', deleted: true };
        }
        const target = s.comments.find(v => v.workspaceId === w && v.id === id);
        target.youtubeModerationStatus = status;
        target.moderatedAt = new Date().toISOString();
        return target;
      });
    });
  }
  function financial(w, p, type) {
    const range = period(p);
    return selected(w, p, 'financial')
      .filter(v => v.type === type && (p.get('history') === 'all' || (v.date >= range.from && v.date <= range.to)))
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  async function saveFinancial(w, body) {
    objectBody(body, ['type', 'title', 'channelId', 'amount', 'currency', 'date', 'stage', 'endDate', 'keywords']);
    const s = state(w);
    if (!s.channels.some(c => c.workspaceId === w && c.id === body.channelId))
      fail(404, 'CHANNEL_NOT_FOUND', 'Canal não encontrado.');
    const type = member(body.type, ['payout', 'deal'], 'type'),
      amount = Number(body.amount);
    if (
      typeof body.amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 1e9 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001
    )
      fail(400, 'INVALID_AMOUNT', 'Use um valor positivo com até duas casas decimais.');
    const row = {
      id: randomUUID(),
      workspaceId: w,
      channelId: body.channelId,
      type,
      title: text(body.title, 'title'),
      amountCents: Math.round(amount * 100),
      currency: member(body.currency, ['BRL', 'USD', 'EUR'], 'currency'),
      date: dateOnly(body.date, 'date'),
      stage: member(
        body.stage,
        type === 'deal' ? ['Proposta', 'Negociação', 'Confirmado', 'Recebido'] : ['Previsto', 'Recebido'],
        'stage',
      ),
      source: 'manual',
      createdAt: new Date().toISOString(),
    };
    if (type === 'deal') Object.assign(row, dealDelivery(body, row.date));
    else if (body.endDate !== undefined || body.keywords !== undefined)
      fail(400, 'INVALID_FIELD', 'Período e palavras-chave valem só para parcerias.');
    await repository.update(s => {
      s.financial ??= [];
      s.financial.push(row);
    });
    return row;
  }
  async function updateFinancial(w, id, body) {
    const row = scoped(w, 'financial', id);
    objectBody(body, ['stage', 'endDate', 'keywords']);
    const changes = {};
    if (body.stage !== undefined || !Object.keys(body).length)
      changes.stage = member(
        body.stage,
        row.type === 'deal' ? ['Proposta', 'Negociação', 'Confirmado', 'Recebido'] : ['Previsto', 'Recebido'],
        'stage',
      );
    if (body.endDate !== undefined || body.keywords !== undefined) {
      if (row.type !== 'deal') fail(400, 'INVALID_FIELD', 'Período e palavras-chave valem só para parcerias.');
      Object.assign(changes, dealDelivery(body, row.date, row));
    }
    return repository.update(s => {
      const target = s.financial.find(v => v.workspaceId === w && v.id === id);
      Object.assign(target, changes);
      return target;
    });
  }
  async function deleteFinancial(w, id) {
    scoped(w, 'financial', id);
    await repository.update(s => {
      s.financial = s.financial.filter(v => !(v.workspaceId === w && v.id === id));
    });
  }
  return {
    catalog,
    summary(w, p) {
      const items = selected(w, p, 'contents');
      return {
        videos: items.filter(c => c.format !== 'Short').length,
        shorts: items.filter(c => c.format === 'Short').length,
        playlists: selected(w, p, 'playlists').length,
      };
    },
    details,
    syncVideo,
    classify,
    syncPlaylists,
    morePlaylist,
    playlists: (w, p) =>
      selected(w, p, 'playlists').filter(v =>
        [v.title, v.description]
          .join(' ')
          .toLocaleLowerCase('pt-BR')
          .includes((p.get('q') ?? '').toLocaleLowerCase('pt-BR')),
      ),
    comments,
    annotate,
    reply,
    moderate,
    financial,
    saveFinancial,
    updateFinancial,
    deleteFinancial,
    async setFormat(w, id, body) {
      content(w, id);
      objectBody(body, ['format']);
      const format = member(body.format, ['Vídeo', 'Short', 'VOD', 'Live'], 'format');
      return repository.update(s => {
        const c = s.contents.find(v => v.workspaceId === w && v.id === id);
        c.format = format;
        c.formatClassification = 'manual';
        return c;
      });
    },
    /**
     * A local goal per metric: YouTube subscribers (the original `subscriberGoal`), and followers or paid
     * subscribers on Twitch/Kick. `metric` defaults to YouTube subscribers.
     */
    async setGoal(w, body) {
      state(w);
      objectBody(body, ['target', 'metric']);
      const metric = member(body.metric ?? GOAL_METRICS[0], GOAL_METRICS, 'metric');
      if (!Number.isInteger(body.target) || body.target < 1 || body.target > 1e9)
        fail(400, 'INVALID_TARGET', 'Meta inválida.');
      return repository.update(s => {
        const value = s.workspaces.find(v => v.id === w);
        if (metric === GOAL_METRICS[0]) value.subscriberGoal = body.target;
        else value.goals = { ...(value.goals ?? {}), [metric]: body.target };
        return { metric, target: body.target };
      });
    },
    goal(w, p = new URLSearchParams()) {
      const metric = member(p.get('metric') ?? GOAL_METRICS[0], GOAL_METRICS, 'metric'),
        workspace = state(w).workspaces.find(v => v.id === w);
      return {
        metric,
        target: (metric === GOAL_METRICS[0] ? workspace.subscriberGoal : workspace.goals?.[metric]) ?? null,
      };
    },
  };
}
