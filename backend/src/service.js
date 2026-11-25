import { randomUUID } from 'node:crypto';
import { platforms, formats, stages, stageForFormat, planChannelIds } from './model.js';
import { contentGame, linkPlans, planRecords } from './planlinks.js';
import { fail, dateOnly, objectBody, text, member } from './errors.js';
export const capabilities = platforms.map(platform => ({
  platform,
  status: 'not_implemented',
  oauth: false,
  catalog: false,
  analytics: false,
  revenue: false,
  management: false,
  reason: 'Conector oficial ainda não implementado; nenhuma conta foi autorizada.',
}));
export function createService(repository) {
  function scope(workspaceId, params = new URLSearchParams()) {
    const state = repository.snapshot();
    if (!state.workspaces.some(w => w.id === workspaceId))
      fail(404, 'WORKSPACE_NOT_FOUND', 'Workspace não encontrado.');
    const platform = params.get('platform');
    if (platform) member(platform, platforms, 'platform');
    const ids = params.getAll('channelId');
    for (const id of ids)
      if (!state.channels.some(c => c.workspaceId === workspaceId && c.id === id))
        fail(404, 'CHANNEL_NOT_FOUND', 'Canal não pertence ao workspace.');
    const end = dateOnly(params.get('to') ?? new Date().toISOString().slice(0, 10), 'to');
    const fromDate = new Date(end + 'T12:00:00Z');
    fromDate.setUTCDate(fromDate.getUTCDate() - 29);
    const start = dateOnly(params.get('from') ?? fromDate.toISOString().slice(0, 10), 'from');
    if (start > end) fail(400, 'INVALID_RANGE', 'from deve ser anterior ou igual a to.');
    if ((Date.parse(end) - Date.parse(start)) / 86400000 > 366)
      fail(400, 'INVALID_RANGE', 'O intervalo máximo é de 366 dias.');
    const channels = state.channels.filter(
      c =>
        c.workspaceId === workspaceId && (!platform || c.platform === platform) && (!ids.length || ids.includes(c.id)),
    );
    const selected = new Set(channels.map(c => c.id));
    const metrics = state.metrics.filter(
      m => m.workspaceId === workspaceId && selected.has(m.channelId) && m.date >= start && m.date <= end,
    );
    return { state, channels, selected, metrics, start, end, workspaceId };
  }
  const total = (rows, key) => rows.reduce((sum, r) => sum + r[key], 0);
  function analytics(s) {
    const hasLive = s.channels.some(c => c.dataSource === 'youtube');
    const views = hasLive ? null : total(s.metrics, 'views'),
      interactions = total(s.metrics, 'interactions');
    const timeseries = [];
    for (
      let day = new Date(s.start + 'T12:00:00Z');
      day.toISOString().slice(0, 10) <= s.end;
      day.setUTCDate(day.getUTCDate() + 1)
    ) {
      const date = day.toISOString().slice(0, 10),
        row = { date };
      for (const p of platforms) {
        const ids = new Set(s.channels.filter(c => c.platform === p).map(c => c.id));
        row[p] = total(
          s.metrics.filter(m => m.date === date && ids.has(m.channelId)),
          'views',
        );
      }
      if (!hasLive) timeseries.push(row);
    }
    return {
      period: { from: s.start, to: s.end },
      summary: {
        views,
        subscribers: s.channels.reduce((n, c) => n + c.subscribers, 0),
        subscribersBasis: 'current_total',
        watchTimeMinutes: hasLive ? null : total(s.metrics, 'watchTimeMinutes'),
        engagementRate: views ? (interactions / views) * 100 : null,
        comparison: null,
      },
      timeseries,
      byPlatform: platforms
        .filter(p => s.channels.some(c => c.platform === p))
        .map(platform => ({ platform, views: hasLive ? null : timeseries.reduce((n, r) => n + r[platform], 0) })),
      availability: {
        audience: { status: 'unavailable', reason: 'Dados demográficos não coletados.' },
        revenue: { status: 'not_connected', reason: 'Integração financeira pendente.' },
      },
    };
  }
  function contents(s, params) {
    const format = params.get('format');
    if (format) member(format, formats, 'format');
    const search = params.get('q')?.toLocaleLowerCase('pt-BR') ?? '';
    const result = s.state.contents
      .filter(
        c =>
          c.workspaceId === s.workspaceId &&
          s.selected.has(c.channelId) &&
          (!format || c.format === format) &&
          c.title.toLocaleLowerCase('pt-BR').includes(search),
      )
      .map(c => ({
        ...c,
        periodViews:
          c.dataSource === 'youtube'
            ? null
            : total(
                s.metrics.filter(m => m.contentId === c.id),
                'views',
              ),
      }));
    const sort = params.get('sort') ?? 'date';
    member(sort, ['date', 'views', 'retention'], 'sort');
    return result.sort((a, b) =>
      sort === 'date'
        ? b.date.localeCompare(a.date)
        : sort === 'views'
          ? (b.periodViews ?? 0) - (a.periodViews ?? 0)
          : b.retention - a.retention,
    );
  }
  function entity(s, collection, id) {
    const item = s.state[collection].find(i => i.workspaceId === s.workspaceId && i.id === id);
    if (!item) fail(404, 'NOT_FOUND', 'Registro não encontrado neste workspace.');
    return item;
  }
  /**
   * Validated plan fields. `existing` is the stored plan on PATCH (undefined on create): the optional links
   * (brand deal, published content) are checked against the workspace and the plan's final channels.
   * Channels: `channelId` (one) or `channelIds` (several, only for a live: multistream); the first is the primary.
   */
  function planValues(body, s, existing) {
    const partial = Boolean(existing);
    objectBody(body, [
      'title',
      'channelId',
      'channelIds',
      'format',
      'date',
      'stage',
      'time',
      'notes',
      'dealId',
      'contentId',
    ]);
    const out = {};
    if (!partial || body.title !== undefined) out.title = text(body.title, 'title');
    if (!partial || body.channelId !== undefined || body.channelIds !== undefined) {
      let ids = [body.channelId];
      if (body.channelIds !== undefined) {
        ids = body.channelIds;
        if (
          !Array.isArray(ids) ||
          !ids.length ||
          ids.length > 6 ||
          ids.some(id => typeof id !== 'string') ||
          new Set(ids).size !== ids.length
        )
          fail(400, 'INVALID_FIELD', 'channelIds deve listar de 1 a 6 canais diferentes.');
        if (body.channelId !== undefined && body.channelId !== ids[0])
          fail(400, 'INVALID_FIELD', 'channelId deve ser o primeiro item de channelIds.');
      }
      const found = ids.map(id => s.state.channels.find(c => c.workspaceId === s.workspaceId && c.id === id));
      if (found.some(c => !c)) fail(404, 'CHANNEL_NOT_FOUND', 'Canal não pertence ao workspace.');
      out.channelId = found[0].id;
      out.platform = found[0].platform;
      out.channelIds = found.map(c => c.id);
      out.platforms = [...new Set(found.map(c => c.platform))];
    }
    if (!partial || body.format !== undefined) out.format = member(body.format, formats, 'format');
    if (!partial || body.date !== undefined) out.date = dateOnly(body.date, 'date');
    if (!partial || body.stage !== undefined) out.stage = member(body.stage ?? 'Ideia', stages, 'stage');
    if (body.time !== undefined) {
      if (body.time !== null && (typeof body.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)))
        fail(400, 'INVALID_FIELD', 'time deve estar no formato HH:MM.');
      out.time = body.time;
    }
    if (body.notes !== undefined) {
      if (typeof body.notes !== 'string' || body.notes.length > 2000)
        fail(400, 'INVALID_FIELD', 'notes deve ter até 2000 caracteres.');
      out.notes = body.notes.trim();
    }
    if (body.dealId !== undefined) {
      if (
        body.dealId !== null &&
        !(s.state.financial ?? []).some(
          f => f.workspaceId === s.workspaceId && f.type === 'deal' && f.id === body.dealId,
        )
      )
        fail(404, 'DEAL_NOT_FOUND', 'Negociação não encontrada neste workspace.');
      out.dealId = body.dealId;
    }
    // Only a live goes to several channels at once. Turning a multistream live into another format keeps its
    // primary channel.
    const format = out.format ?? existing?.format;
    let channelIds = out.channelIds ?? planChannelIds(existing);
    if (format !== 'Live' && channelIds.length > 1) {
      if (body.channelIds !== undefined)
        fail(400, 'MULTISTREAM_LIVE_ONLY', 'Só uma live pode ir para mais de um canal ao mesmo tempo (multistream).');
      channelIds = [channelIds[0]];
      out.channelId = channelIds[0];
      out.channelIds = channelIds;
      out.platform = s.state.channels.find(c => c.id === channelIds[0])?.platform ?? existing.platform;
      out.platforms = [out.platform];
    }
    const contentIn = id =>
      s.state.contents.some(c => c.workspaceId === s.workspaceId && c.id === id && channelIds.includes(c.channelId));
    if (body.contentId !== undefined) {
      if (body.contentId !== null && !contentIn(body.contentId))
        fail(404, 'CONTENT_NOT_FOUND', 'Conteúdo não encontrado nos canais do plano.');
      out.contentId = body.contentId;
    } else if (partial && out.channelIds && existing.contentId && !contentIn(existing.contentId)) out.contentId = null; // the linked video belongs to a channel the plan no longer uses
    if (partial && !Object.keys(out).length) fail(400, 'EMPTY_PATCH', 'Informe ao menos um campo.');
    // The stage must exist in the format's flow (a live has no recording/editing). Changing only the format moves
    // the plan to the nearest stage of the new flow.
    const stage = out.stage ?? existing?.stage;
    if (format && stage && stageForFormat(stage, format) !== stage) {
      if (body.stage !== undefined) fail(400, 'STAGE_NOT_IN_FLOW', `A etapa ${stage} não se aplica a ${format}.`);
      out.stage = stageForFormat(stage, format);
    }
    return out;
  }
  /**
   * A plan as returned by the API, with its brand deal and the content that fulfilled it (picked by hand, or linked
   * automatically: see planlinks.js). `links` comes from linkPlans() for the plan's workspace.
   */
  function planView(state, plan, links = linkPlans(state, plan.workspaceId)) {
    const w = plan.workspaceId;
    const deal = plan.dealId
      ? (state.financial ?? []).find(f => f.workspaceId === w && f.type === 'deal' && f.id === plan.dealId)
      : null;
    const channelIds = planChannelIds(plan);
    const { content, linked } = links.get(plan.id) ?? {};
    return {
      ...plan,
      channelIds,
      platforms: plan.platforms ?? [plan.platform],
      deal: deal
        ? { id: deal.id, title: deal.title, amountCents: deal.amountCents, currency: deal.currency, stage: deal.stage }
        : null,
      content: content
        ? {
            id: content.id,
            title: content.title,
            date: content.date ?? null,
            thumbnailUrl: content.thumbnailUrl ?? content.image ?? null,
            watchUrl: content.watchUrl ?? null,
            views: content.views ?? null,
            game: contentGame(state, content),
            linked,
          }
        : null,
    };
  }
  return {
    workspaces: () => repository.snapshot().workspaces,
    channels: (w, p) => scope(w, p).channels,
    connections: w => {
      scope(w);
      return { items: [], providers: capabilities };
    },
    overview: (w, p) => {
      const s = scope(w, p);
      const a = analytics(s);
      const ranked = contents(s, p).sort((a, b) => (b.periodViews ?? 0) - (a.periodViews ?? 0));
      return {
        ...a,
        latestContent: contents(s, new URLSearchParams())[0] ?? null,
        topContents: ranked.slice(0, 5),
        nextPlans: s.state.plans
          .filter(
            i =>
              i.workspaceId === w &&
              planChannelIds(i).some(id => s.selected.has(id)) &&
              i.date >= new Date().toISOString().slice(0, 10),
          )
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 3),
        lastSyncedAt: null,
      };
    },
    analytics: (w, p) => analytics(scope(w, p)),
    contents: (w, p) => contents(scope(w, p), p),
    content: (w, id, p) => {
      const s = scope(w, p);
      const c = entity(s, 'contents', id);
      return {
        ...c,
        period: { from: s.start, to: s.end },
        periodViews:
          c.dataSource === 'youtube'
            ? null
            : total(
                s.metrics.filter(m => m.contentId === id),
                'views',
              ),
        retentionCurve: null,
        diagnosis: { status: 'unavailable', reason: 'Diagnóstico automático requer métricas reais.' },
      };
    },
    revenue: (w, p) => {
      const s = scope(w, p);
      return {
        period: { from: s.start, to: s.end },
        status: 'not_connected',
        totals: [],
        entries: [],
        payouts: [],
        reason: 'Nenhum conector financeiro implementado. Ausência de receita disponível não significa receita zero.',
      };
    },
    plans: (w, p) => {
      const s = scope(w, p),
        links = linkPlans(s.state, w);
      return s.state.plans
        .filter(
          i =>
            i.workspaceId === w &&
            planChannelIds(i).some(id => s.selected.has(id)) &&
            i.date >= s.start &&
            i.date <= s.end,
        )
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
        .map(plan => planView(s.state, plan, links));
    },
    /** Published content and detected lives in the range that no plan claims (calendar records). */
    planRecords: (w, p) => {
      const s = scope(w, p);
      return planRecords(s.state, w, {
        from: s.start,
        to: s.end,
        channelIds: [...s.selected],
        links: linkPlans(s.state, w),
      });
    },
    createPlan: async (w, body) => {
      const s = scope(w);
      const values = planValues(body, s);
      const created = await repository.update(state => {
        const plan = {
          id: randomUUID(),
          workspaceId: w,
          ...values,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.plans.push(plan);
        return plan;
      });
      return planView(repository.snapshot(), created);
    },
    updatePlan: async (w, id, body) => {
      const s = scope(w);
      const values = planValues(body, s, entity(s, 'plans', id));
      const updated = await repository.update(state => {
        const p = state.plans.find(i => i.workspaceId === w && i.id === id);
        if (!p) fail(404, 'NOT_FOUND', 'Planejamento não encontrado.');
        Object.assign(p, values, { updatedAt: new Date().toISOString() });
        return p;
      });
      return planView(repository.snapshot(), updated);
    },
    deletePlan: async (w, id) => {
      scope(w);
      return repository.update(state => {
        const index = state.plans.findIndex(i => i.workspaceId === w && i.id === id);
        if (index < 0) fail(404, 'NOT_FOUND', 'Planejamento não encontrado.');
        state.plans.splice(index, 1);
        return null;
      });
    },
    comments: (w, p) => {
      const s = scope(w, p);
      return s.state.comments
        .filter(c => c.workspaceId === w && s.selected.has(c.channelId))
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    },
    updateComment: async (w, id, body) => {
      const s = scope(w);
      entity(s, 'comments', id);
      objectBody(body, ['hearted']);
      if (typeof body.hearted !== 'boolean') fail(400, 'INVALID_FIELD', 'hearted deve ser booleano.');
      return repository.update(state => {
        const c = state.comments.find(c => c.workspaceId === w && c.id === id);
        c.hearted = body.hearted;
        return c;
      });
    },
    reply: async (w, id, body) => {
      const s = scope(w);
      entity(s, 'comments', id);
      objectBody(body, ['text']);
      const value = text(body.text, 'text', 2000);
      return repository.update(state => {
        const c = state.comments.find(c => c.workspaceId === w && c.id === id);
        const reply = { id: randomUUID(), text: value, createdAt: new Date().toISOString(), delivery: 'local_only' };
        c.replies.push(reply);
        return reply;
      });
    },
  };
}
