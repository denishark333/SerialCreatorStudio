import { fail } from './errors.js';
export const MEMBERS_SCOPE = 'https://www.googleapis.com/auth/youtube.channel-memberships.creator';
export function membershipFor(state, w, channelId, authorId) {
  const snapshot = (state.membershipSnapshots ?? []).find(v => v.workspaceId === w && v.channelId === channelId);
  if (!authorId || snapshot?.status !== 'available')
    return { status: 'unknown', member: null, checkedAt: snapshot?.checkedAt ?? null };
  const member = snapshot.items.find(v => v.externalId === authorId) ?? null;
  return { status: member ? 'member' : 'not_member', member, checkedAt: snapshot.checkedAt };
}
export function createMemberships({ repository, youtube }) {
  async function save(w, id, value) {
    return repository.update(s => {
      if (!s.channels.some(c => c.workspaceId === w && c.id === id)) return;
      s.membershipSnapshots ??= [];
      const old = s.membershipSnapshots.find(v => v.workspaceId === w && v.channelId === id);
      const next = {
        workspaceId: w,
        channelId: id,
        items: [],
        levels: [],
        ...old,
        ...value,
        checkedAt: new Date().toISOString(),
      };
      if (old) Object.assign(old, next);
      else s.membershipSnapshots.push(next);
      return next;
    });
  }
  async function sync(w, id) {
    const state = repository.snapshot(),
      channel = state.channels.find(c => c.workspaceId === w && c.id === id);
    if (!channel) fail(404, 'CHANNEL_NOT_FOUND', 'Canal não encontrado.');
    if (channel.platform !== 'YouTube') return;
    const grant = state.connections.find(c => c.workspaceId === w && c.id === channel.connectionId);
    if (!grant?.scopes?.includes(MEMBERS_SCOPE))
      return save(w, id, {
        status: 'permission_required',
        reason: 'A lista de membros exige liberação do canal pelo YouTube e autorização de membros no login.',
      });
    try {
      return await youtube.runChannelTask(
        w,
        id,
        async provider => {
          const items = [],
            seen = new Set();
          let cursor;
          do {
            const page = await provider.data('members', {
              part: 'snippet',
              mode: 'all_current',
              maxResults: '1000',
              ...(cursor ? { pageToken: cursor } : {}),
            });
            if (!Array.isArray(page.items)) throw new Error('Resposta de membros inválida.');
            for (const row of page.items) {
              const snippet = row.snippet,
                person = snippet?.memberDetails,
                details = snippet?.membershipsDetails;
              if (!person?.channelId || snippet.creatorChannelId !== channel.externalId)
                throw new Error('Invalid membership channel.');
              items.push({
                externalId: person.channelId,
                name: person.displayName ?? person.channelId,
                thumbnailUrl: person.profileImageUrl ?? null,
                channelUrl: person.channelUrl ?? null,
                levelId: details?.highestAccessibleLevel ?? null,
                levelName: details?.highestAccessibleLevelDisplayName ?? null,
                accessibleLevels: details?.accessibleLevels ?? [],
                memberSince: details?.membershipsDuration?.memberSince ?? null,
                months: details?.membershipsDuration?.memberTotalDurationMonths ?? null,
              });
            }
            cursor = page.nextPageToken;
            if (cursor) {
              if (seen.has(cursor) || seen.size >= 200)
                throw new Error('Não foi possível concluir a paginação dos membros.');
              seen.add(cursor);
            }
          } while (cursor);
          let levels = [],
            levelsReason = null;
          try {
            const response = await provider.data('membershipsLevels', { part: 'id,snippet' });
            levels = (response.items ?? []).map(v => ({
              id: v.id,
              name: v.snippet?.levelDetails?.displayName ?? v.id,
            }));
          } catch {
            levelsReason = 'Níveis não retornados pela plataforma.';
          }
          return save(w, id, {
            status: 'available',
            reason: null,
            items: [...new Map(items.map(v => [v.externalId, v])).values()],
            levels,
            levelsReason,
            lastSuccessAt: new Date().toISOString(),
          });
        },
        { readOnly: true },
      );
    } catch (error) {
      return save(w, id, {
        status: error.details?.reason === 'channelMembershipsNotEnabled' ? 'not_enabled' : 'unavailable',
        reason:
          'O YouTube não disponibilizou a lista de membros. Verifique a liberação do canal e as permissões da conexão.',
      });
    }
  }
  function list(w, p) {
    const state = repository.snapshot();
    if (!state.workspaces.some(v => v.id === w)) fail(404, 'WORKSPACE_NOT_FOUND', 'Estúdio não encontrado.');
    const ids = p.getAll('channelId');
    for (const id of ids)
      if (!state.channels.some(c => c.workspaceId === w && c.id === id))
        fail(404, 'CHANNEL_NOT_FOUND', 'Canal não encontrado.');
    const channels = state.channels.filter(
        c =>
          c.workspaceId === w &&
          (!ids.length || ids.includes(c.id)) &&
          (!p.get('platform') || c.platform === p.get('platform')),
      ),
      coverage = channels.map(channel => {
        const saved = (state.membershipSnapshots ?? []).find(v => v.workspaceId === w && v.channelId === channel.id);
        return {
          channelId: channel.id,
          name: channel.name,
          status: channel.platform !== 'YouTube' ? 'unsupported' : (saved?.status ?? 'not_synced'),
          reason:
            channel.platform !== 'YouTube'
              ? 'A lista de assinantes desta plataforma ainda não está integrada.'
              : (saved?.reason ?? (!saved ? 'Aguardando coleta global de membros.' : null)),
          checkedAt: saved?.checkedAt ?? null,
        };
      });
    const valid = coverage.filter(c => c.status === 'available'),
      complete = channels.length > 0 && valid.length === channels.length;
    let items = valid.flatMap(c => {
      const s = state.membershipSnapshots.find(v => v.workspaceId === w && v.channelId === c.channelId);
      return s.items.map(v => ({ ...v, channelId: c.channelId, channelName: c.name, checkedAt: s.checkedAt }));
    });
    const knownCount = items.length,
      levels = [];
    for (const c of valid) {
      const s = state.membershipSnapshots.find(v => v.workspaceId === w && v.channelId === c.channelId),
        names = new Map(s.levels.map(v => [v.id, v.name]));
      for (const v of s.items) if (v.levelId && !names.has(v.levelId)) names.set(v.levelId, v.levelName ?? v.levelId);
      for (const [id, name] of names) {
        const count = s.items.filter(v => v.levelId === id).length;
        levels.push({ id, channelId: c.channelId, channelName: c.name, name, count });
      }
    }
    const q = (p.get('q') ?? '').toLocaleLowerCase('pt-BR');
    items = items
      .filter(v => !q || v.name.toLocaleLowerCase('pt-BR').includes(q))
      .sort((a, b) => (b.memberSince ?? '').localeCompare(a.memberSince ?? ''));
    const page = Number(p.get('page') ?? 1),
      limit = Number(p.get('limit') ?? 25);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100)
      fail(400, 'INVALID_PAGINATION', 'Página inválida.');
    return {
      status: complete ? 'available' : valid.length ? 'partial' : 'unavailable',
      total: complete ? knownCount : null,
      knownCount,
      levels,
      coverage,
      items: items.slice((page - 1) * limit, page * limit),
      pagination: { page, limit, total: items.length, totalPages: Math.ceil(items.length / limit) },
      revenue: {
        amount: null,
        currency: null,
        reason: 'A API de membros não informa o preço pago nem a receita líquida.',
      },
    };
  }
  return { sync, list };
}
