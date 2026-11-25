import { fail, dateOnly } from './errors.js';
import { planChannelIds } from './model.js';
const ANALYTICS = 'https://www.googleapis.com/auth/yt-analytics.readonly';
const MONETARY = 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly';
const fields = 'views,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost';
const rows = report =>
  (report.rows ?? []).map(row => Object.fromEntries(report.columnHeaders.map((h, i) => [h.name, row[i]])));
const unavailable = (status, reason) => ({ status, reason, rows: [] });
const sum = (items, key) => items.reduce((n, item) => n + Number(item[key] ?? 0), 0);
export function period(params) {
  const to = dateOnly(params.get('to') ?? new Date().toISOString().slice(0, 10), 'to');
  const date = new Date(to + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - 29);
  const from = dateOnly(params.get('from') ?? date.toISOString().slice(0, 10), 'from');
  if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 366)
    fail(400, 'INVALID_RANGE', 'Selecione um intervalo válido de até 367 dias.');
  return { from, to };
}
export function createReports({ repository, youtube }) {
  function selection(workspaceId, params) {
    const state = repository.snapshot();
    const { from, to } = period(params);
    const ids = params.getAll('channelId');
    if (params.get('platform') && !['YouTube', 'Twitch', 'Kick'].includes(params.get('platform')))
      fail(400, 'INVALID_PLATFORM', 'Invalid platform.');
    if (!state.workspaces.some(w => w.id === workspaceId))
      fail(404, 'WORKSPACE_NOT_FOUND', 'Conecte um canal primeiro.');
    const all = state.channels.filter(
      c => c.workspaceId === workspaceId && ['youtube', 'twitch', 'kick'].includes(c.dataSource),
    );
    for (const id of ids)
      if (!all.some(c => c.id === id)) fail(404, 'CHANNEL_NOT_FOUND', 'Canal não encontrado neste workspace.');
    const channels = all.filter(
      c => (!ids.length || ids.includes(c.id)) && (!params.get('platform') || params.get('platform') === c.platform),
    );
    return { state, channels, from, to, workspaceId };
  }
  async function sync(workspaceId, channelId, params) {
    const range = period(params);
    return youtube.runChannelTask(
      workspaceId,
      channelId,
      async provider => {
        const fetchedAt = new Date().toISOString();
        const base = { startDate: range.from, endDate: range.to };
        async function get(query) {
          try {
            const report = await provider.report({ ...base, ...query });
            if (!Array.isArray(report.columnHeaders))
              return unavailable('unavailable', 'Resposta do relatório não reconhecida.');
            const data = rows(report);
            return {
              status: data.length ? 'available' : 'no_data',
              reason: data.length ? null : 'O YouTube não retornou linhas para este período.',
              rows: data,
            };
          } catch (error) {
            return unavailable(
              error.code === 'YOUTUBE_REAUTHORIZE' ? 'reauthorization_required' : 'unavailable',
              error.message,
            );
          }
        }
        let daily, top, countries, devices, revenue, ages, subscribed, traffic;
        if (provider.scopes.includes(ANALYTICS) || provider.scopes.includes(MONETARY)) {
          [daily, top, countries, devices, ages, subscribed, traffic] = await Promise.all([
            get({ dimensions: 'day', metrics: fields, sort: 'day', maxResults: '1000' }),
            get({
              dimensions: 'video',
              metrics: 'views,estimatedMinutesWatched,averageViewPercentage',
              sort: '-views',
              maxResults: '200',
            }),
            get({ dimensions: 'country', metrics: 'views', sort: '-views', maxResults: '25' }),
            get({ dimensions: 'deviceType', metrics: 'views', sort: '-views' }),
            get({ dimensions: 'ageGroup', metrics: 'viewerPercentage', sort: 'ageGroup' }),
            get({ dimensions: 'subscribedStatus', metrics: 'views,estimatedMinutesWatched' }),
            get({ dimensions: 'insightTrafficSourceType', metrics: 'views', sort: '-views' }),
          ]);
        } else {
          daily =
            top =
            countries =
            devices =
            ages =
            subscribed =
            traffic =
              unavailable('permission_required', 'Reconecte o canal concedendo acesso ao YouTube Analytics.');
        }
        revenue = provider.scopes.includes(MONETARY)
          ? await get({
              dimensions: 'day',
              metrics: 'estimatedRevenue',
              sort: 'day',
              currency: 'USD',
              maxResults: '1000',
            })
          : unavailable('permission_required', 'Autorize a leitura financeira para consultar receitas estimadas.');
        // Refresh current channel totals independently from time-range reports.
        try {
          const response = await provider.data('channels', { part: 'statistics', id: provider.channel.externalId });
          const stats = response.items?.[0]?.statistics;
          if (stats)
            await repository.update(s => {
              const c = s.channels.find(c => c.workspaceId === workspaceId && c.id === channelId);
              if (c) {
                c.subscribers = stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? 0);
                c.totalViews = Number(stats.viewCount ?? 0);
                c.totalVideos = Number(stats.videoCount ?? 0);
                c.statisticsUpdatedAt = fetchedAt;
              }
            });
        } catch {
          /* A channel total failure must not discard successful reports. */
        }
        const bundle = {
          workspaceId,
          channelId,
          ...range,
          fetchedAt,
          timezone: 'America/Los_Angeles',
          daily,
          top,
          countries,
          devices,
          ages,
          subscribed,
          traffic,
          revenue,
          currency: 'USD',
        };
        await repository.update(s => {
          s.reports ??= [];
          const previous = s.reports.find(
            r =>
              r.workspaceId === workspaceId && r.channelId === channelId && r.from === range.from && r.to === range.to,
          );
          if (previous) Object.assign(previous, bundle);
          else s.reports.push(bundle);
        });
        return {
          channelId,
          ...range,
          fetchedAt,
          sections: Object.fromEntries(
            ['daily', 'top', 'countries', 'devices', 'ages', 'subscribed', 'traffic', 'revenue'].map(k => [
              k,
              bundle[k].status,
            ]),
          ),
        };
      },
      { readOnly: true },
    );
  }
  function analytics(workspaceId, params) {
    const s = selection(workspaceId, params);
    const sections = s.channels.map(channel => ({
      channel,
      report: (s.state.reports ?? []).find(
        r => r.workspaceId === workspaceId && r.channelId === channel.id && r.from === s.from && r.to === s.to,
      ),
    }));
    const coverage = sections.map(({ channel, report }) => ({
      channelId: channel.id,
      name: channel.name,
      status: channel.platform !== 'YouTube' ? 'unsupported' : (report?.daily.status ?? 'not_synced'),
      reason:
        channel.platform !== 'YouTube'
          ? 'Esta plataforma não disponibiliza estes relatórios históricos pela API.'
          : (report?.daily.reason ?? (!report ? 'Sincronize os relatórios deste período.' : null)),
      fetchedAt: report?.fetchedAt ?? null,
    }));
    const covered = coverage.filter(c => c.status !== 'unsupported');
    const complete = covered.length > 0 && covered.every(c => ['available', 'no_data'].includes(c.status));
    const daily = sections.flatMap(({ channel, report }) =>
      (report?.daily.rows ?? []).map(r => ({ ...r, channelId: channel.id })),
    );
    const byDate = new Map();
    for (const r of daily) {
      const row = byDate.get(r.day) ?? {
        date: r.day,
        YouTube: 0,
        watchTimeMinutes: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        subscribersGained: 0,
        subscribersLost: 0,
      };
      row.YouTube += r.views;
      row.watchTimeMinutes += r.estimatedMinutesWatched;
      for (const k of ['likes', 'comments', 'shares', 'subscribersGained', 'subscribersLost']) row[k] += r[k] ?? 0;
      byDate.set(r.day, row);
    }
    const views = complete && daily.length ? sum(daily, 'views') : null;
    const youtubeChannels = s.channels.filter(c => c.platform === 'YouTube');
    const totalSubscribers =
      youtubeChannels.length && youtubeChannels.every(c => c.subscribers !== null)
        ? sum(youtubeChannels, 'subscribers')
        : null;
    const top = sections
      .flatMap(({ channel, report }) =>
        (report?.top.rows ?? []).map(r => {
          const content = s.state.contents.find(
            c => c.workspaceId === workspaceId && c.channelId === channel.id && c.externalId === r.video,
          );
          const detail = (s.state.videoReports ?? []).find(
            v => v.workspaceId === workspaceId && v.contentId === content?.id && v.from === s.from && v.to === s.to,
          );
          return {
            likes: detail?.summary?.rows?.[0]?.likes ?? null,
            comments: detail?.summary?.rows?.[0]?.comments ?? null,
            shares: detail?.summary?.rows?.[0]?.shares ?? null,
            dailyViews: detail?.daily?.rows ?? null,
            retentionCurve: detail?.retention?.rows ?? null,
            id: content?.id ?? null,
            externalId: r.video,
            channelId: channel.id,
            title: content?.title ?? 'Vídeo ' + r.video,
            thumbnailUrl: content?.thumbnailUrl ?? null,
            views: r.views,
            watchTimeMinutes: r.estimatedMinutesWatched,
            averageViewPercentage: r.averageViewPercentage,
          };
        }),
      )
      .sort((a, b) => b.views - a.views);
    function audience(key, dimension) {
      const valid = sections.filter(s => s.report && ['available', 'no_data'].includes(s.report[key]?.status));
      const items = new Map();
      for (const { report } of valid)
        for (const r of report[key].rows) items.set(r[dimension], (items.get(r[dimension]) ?? 0) + r.views);
      return {
        status: valid.length === sections.length && valid.length ? 'available' : 'partial',
        items: [...items].map(([label, views]) => ({ label, views })).sort((a, b) => b.views - a.views),
        coverage: sections.map(({ channel, report }) => ({
          channelId: channel.id,
          status: report?.[key]?.status ?? 'not_synced',
          reason: report?.[key]?.reason ?? null,
        })),
      };
    }
    return {
      period: { from: s.from, to: s.to },
      timezone: 'America/Los_Angeles',
      status: complete ? (daily.length ? 'available' : 'no_data') : 'partial',
      coverage,
      summary: {
        views,
        likes: views === null ? null : sum(daily, 'likes'),
        comments: views === null ? null : sum(daily, 'comments'),
        shares: views === null ? null : sum(daily, 'shares'),
        subscribers: totalSubscribers,
        watchTimeMinutes: views === null ? null : sum(daily, 'estimatedMinutesWatched'),
        engagementRate: views
          ? ((sum(daily, 'likes') + sum(daily, 'comments') + sum(daily, 'shares')) / views) * 100
          : null,
        subscribersGained: views === null ? null : sum(daily, 'subscribersGained'),
        subscribersLost: views === null ? null : sum(daily, 'subscribersLost'),
        comparison: null,
      },
      timeseries: complete ? [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) : [],
      topContents: top,
      topLimitPerChannel: 200,
      audience: {
        countries: audience('countries', 'country'),
        devices: audience('devices', 'deviceType'),
        subscribed: audience('subscribed', 'subscribedStatus'),
        ages:
          sections.filter(v => v.channel.platform === 'YouTube').length === 1
            ? {
                status: sections.find(v => v.channel.platform === 'YouTube')?.report?.ages?.status ?? 'not_synced',
                items: (sections.find(v => v.channel.platform === 'YouTube')?.report?.ages?.rows ?? []).map(r => ({
                  label: r.ageGroup,
                  percentage: r.viewerPercentage,
                })),
                reason: sections.find(v => v.channel.platform === 'YouTube')?.report?.ages?.reason ?? null,
              }
            : {
                status: 'select_channel',
                items: [],
                reason: 'Selecione um canal YouTube para consultar os percentuais demográficos.',
              },
      },
      traffic: audience('traffic', 'insightTrafficSourceType'),
      dataThrough: daily.length
        ? daily
            .map(r => r.day)
            .sort()
            .at(-1)
        : null,
    };
  }
  function overview(w, p) {
    const a = analytics(w, p),
      s = selection(w, p);
    const ids = new Set(s.channels.map(c => c.id));
    const contents = s.state.contents.filter(c => c.workspaceId === w && ids.has(c.channelId));
    return {
      ...a,
      channels: s.channels,
      catalogCount: contents.length,
      lifetimeViews: contents.length ? sum(contents, 'views') : null,
      latestContent: contents.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0] ?? null,
      nextPlans: s.state.plans
        .filter(
          i =>
            i.workspaceId === w &&
            planChannelIds(i).some(id => ids.has(id)) &&
            i.date >= new Date().toISOString().slice(0, 10),
        )
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 4),
    };
  }
  function revenue(w, p) {
    const s = selection(w, p);
    const coverage = s.channels.map(c => {
      const report = (s.state.reports ?? []).find(
        r => r.workspaceId === w && r.channelId === c.id && r.from === s.from && r.to === s.to,
      );
      return {
        channelId: c.id,
        name: c.name,
        status: c.platform !== 'YouTube' ? 'unsupported' : (report?.revenue.status ?? 'not_synced'),
        reason:
          c.platform !== 'YouTube'
            ? 'Receita não exposta pela API desta plataforma.'
            : report
              ? report.revenue.reason
              : 'Sincronize os relatórios deste período.',
        report,
      };
    });
    const good = coverage.length > 0 && coverage.every(c => ['available', 'no_data'].includes(c.status));
    const entries = coverage.flatMap(c =>
      (c.report?.revenue.rows ?? []).map(r => ({
        channelId: c.channelId,
        date: r.day,
        amount: r.estimatedRevenue,
        currency: 'USD',
        nature: 'estimated',
      })),
    );
    return {
      period: { from: s.from, to: s.to },
      status: good ? (entries.length ? 'available' : 'no_data') : 'partial',
      currency: 'USD',
      nature: 'estimated',
      amount: good && entries.length ? sum(entries, 'amount') : null,
      entries,
      coverage: coverage.map(({ report, ...c }) => c),
      payouts: [],
      payoutsStatus: 'unavailable',
      reason: 'Receita estimada do YouTube; não representa saldo ou pagamento confirmado.',
    };
  }
  /**
   * Comment threads of a channel, newest first.
   * - `mode: 'full'` (default): one page per call, resuming the persisted cursor; the synchronizer calls it until
   *   `complete`. Every thread's replies are read again (once a day: catches edited and removed replies).
   * - `mode: 'incremental'`: starts at the newest page and stops at the first page whose threads are all known
   *   with the same reply count (a few times a day). The full-mode cursor is left untouched.
   * Replies come inline with the thread (up to 5, no extra quota); comments.list (1 unit per thread) is called
   * only when the thread has more replies, and in incremental mode only when its reply count changed.
   */
  async function syncComments(w, id, { mode = 'full', maxPages = 5 } = {}) {
    const incremental = mode === 'incremental';
    return youtube.runChannelTask(
      w,
      id,
      async provider => {
        if (
          !provider.scopes.includes('https://www.googleapis.com/auth/youtube.force-ssl') &&
          !provider.scopes.includes('https://www.googleapis.com/auth/youtube')
        )
          fail(403, 'YOUTUBE_COMMENTS_PERMISSION_REQUIRED', 'Atualize a conexão do canal.');
        const toReply = reply => {
          const r = reply?.snippet;
          if (!reply?.id || !r) return null;
          return {
            id: reply.id,
            text: r.textDisplay ?? r.textOriginal ?? '',
            author: r.authorDisplayName ?? '',
            authorChannelId: r.authorChannelId?.value ?? null,
            isOwner: r.authorChannelId?.value === provider.channel.externalId,
            createdAt: r.publishedAt,
            updatedAt: r.updatedAt,
            delivery: 'youtube',
            source: 'youtube',
          };
        };
        // A full pass starting from the first page records when it began: once it reaches the last page, cached
        // comments it did not see again were deleted on YouTube and are removed (see page()).
        if (!incremental && !provider.channel.commentsNextPageToken)
          await repository.update(s => {
            const channel = s.channels.find(c => c.workspaceId === w && c.id === id);
            if (channel) channel.commentsFullStartedAt = new Date().toISOString();
          });
        let pageToken = incremental ? null : provider.channel.commentsNextPageToken,
          imported = 0,
          pages = 0,
          complete = false,
          lastFetch;
        do {
          const result = await page(pageToken);
          imported += result.imported;
          pages++;
          pageToken = result.nextPageToken;
          lastFetch = result.fetchedAt;
          complete = !pageToken || (incremental && result.allKnown);
        } while (incremental && !complete && pages < maxPages);
        return { imported, pages, complete: incremental ? true : complete, fetchedAt: lastFetch };

        async function page(cursorToken) {
          const response = await provider.data('commentThreads', {
            part: 'snippet,replies',
            allThreadsRelatedToChannelId: provider.channel.externalId,
            maxResults: '100',
            order: 'time',
            textFormat: 'plainText',
            ...(cursorToken ? { pageToken: cursorToken } : {}),
          });
          if (!Array.isArray(response.items)) fail(424, 'INVALID_COMMENTS_RESPONSE', 'Invalid comment response.');
          const fetchedAt = new Date().toISOString();
          const collected = [];
          const stored = repository.snapshot().comments;
          let allKnown = response.items.length > 0;
          for (const thread of response.items) {
            const item = thread.snippet.topLevelComment,
              detail = item.snippet,
              total = thread.snippet.totalReplyCount ?? 0;
            const known = stored.find(c => c.workspaceId === w && c.id === 'yt-comment-' + item.id);
            const unchanged = Boolean(known) && known.replyCount === total && known.repliesSyncStatus === 'available';
            if (!unchanged) allKnown = false;
            let replies = [],
              repliesSyncStatus = 'available',
              repliesError = null,
              keepReplies = false;
            const inline = (thread.replies?.comments ?? []).map(toReply).filter(Boolean);
            if (total > 0 && inline.length >= total) replies = inline;
            else if (total > 0 && incremental && unchanged) keepReplies = true;
            else if (total > 0) {
              try {
                let cursor;
                do {
                  const result = await provider.data('comments', {
                    part: 'snippet',
                    parentId: item.id,
                    maxResults: '100',
                    textFormat: 'plainText',
                    ...(cursor ? { pageToken: cursor } : {}),
                  });
                  for (const reply of result.items ?? []) {
                    const value = toReply(reply);
                    if (value) replies.push(value);
                  }
                  cursor = result.nextPageToken;
                } while (cursor);
              } catch (e) {
                repliesSyncStatus = 'unavailable';
                repliesError = e.message;
              }
            }
            collected.push({
              keepReplies,
              id: 'yt-comment-' + item.id,
              externalId: item.id,
              workspaceId: w,
              channelId: id,
              contentId: detail.videoId ? 'yt-video-' + detail.videoId : null,
              videoId: detail.videoId,
              platform: 'YouTube',
              author: detail.authorDisplayName,
              authorChannelId: detail.authorChannelId?.value ?? null,
              authorProfileImageUrl: detail.authorProfileImageUrl ?? null,
              text: detail.textDisplay,
              publishedAt: detail.publishedAt,
              likeCount: detail.likeCount,
              viewerRating: detail.viewerRating ?? null,
              canReply: thread.snippet.canReply !== false,
              replyCount: thread.snippet.totalReplyCount,
              replies,
              repliesSyncStatus,
              repliesError,
              dataSource: 'youtube',
              lastSyncedAt: fetchedAt,
            });
          }
          await repository.update(s => {
            for (const { keepReplies, ...row } of collected) {
              const old = s.comments.find(c => c.workspaceId === w && c.id === row.id);
              if (old) {
                const { replies, ...rest } = row;
                const previous = new Map((old.replies ?? []).map(r => [r.id, r]));
                Object.assign(old, rest);
                if (row.repliesSyncStatus === 'available' && !keepReplies)
                  old.replies = replies.map(r => ({
                    ...r,
                    ...(previous.get(r.id)?.requestId ? { requestId: previous.get(r.id).requestId } : {}),
                  }));
                old.youtubeModerationStatus = 'published';
              } else s.comments.push(row);
            }
            const channel = s.channels.find(c => c.workspaceId === w && c.id === id);
            if (!incremental) channel.commentsNextPageToken = response.nextPageToken ?? null;
            channel.commentsSyncedAt = fetchedAt;
            const started = channel.commentsFullStartedAt;
            if (!incremental && !response.nextPageToken && started) {
              // Held-for-review comments are not listed by the API but still exist: they stay.
              s.comments = s.comments.filter(
                v =>
                  v.workspaceId !== w ||
                  v.channelId !== id ||
                  v.dataSource !== 'youtube' ||
                  v.youtubeModerationStatus === 'heldForReview' ||
                  (v.lastSyncedAt ?? '') >= started,
              );
              delete channel.commentsFullStartedAt;
            }
          });
          return {
            imported: response.items.length,
            nextPageToken: response.nextPageToken ?? null,
            allKnown,
            fetchedAt,
          };
        }
      },
      { readOnly: true },
    );
  }
  return { sync, analytics, overview, revenue, syncComments };
}
