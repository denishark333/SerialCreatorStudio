export const platforms = ['YouTube', 'Twitch', 'Kick'];
export const formats = ['Vídeo', 'Short', 'VOD', 'Clip', 'Live'];
/** Production stages of a plan; 'Publicado' is set by the publish action. */
export const stages = ['Ideia', 'Roteiro', 'Gravação', 'Edição', 'Pronto', 'Publicado'];
/**
 * Production stages per format (before 'Publicado'): a live is not recorded or edited beforehand, and VODs/clips
 * come from a live that already happened, so they only need editing.
 */
export const stageFlows = {
  Vídeo: ['Ideia', 'Roteiro', 'Gravação', 'Edição', 'Pronto'],
  Short: ['Ideia', 'Roteiro', 'Gravação', 'Edição', 'Pronto'],
  Live: ['Ideia', 'Roteiro', 'Pronto'],
  VOD: ['Ideia', 'Edição', 'Pronto'],
  Clip: ['Ideia', 'Edição', 'Pronto'],
};
/** Every channel of a plan: a live can go to several at once (multistream); older plans only have `channelId`. */
export function planChannelIds(plan) {
  return Array.isArray(plan?.channelIds) && plan.channelIds.length ? plan.channelIds : [plan?.channelId];
}
/**
 * Removes channels from the plans that use them (disconnected account): a multistream plan keeps its other
 * channels; a plan left without channels is deleted.
 */
export function detachPlanChannels(state, workspaceId, ids) {
  state.plans = (state.plans ?? []).flatMap(plan => {
    if (plan.workspaceId !== workspaceId) return [plan];
    const kept = planChannelIds(plan).filter(id => !ids.has(id));
    if (!kept.length) return [];
    if (kept.length === planChannelIds(plan).length) return [plan];
    const channels = kept.map(id => state.channels.find(c => c.id === id)).filter(Boolean);
    return [
      {
        ...plan,
        channelId: kept[0],
        channelIds: kept,
        platform: channels[0]?.platform ?? plan.platform,
        platforms: [...new Set(channels.map(c => c.platform))],
      },
    ];
  });
}
/** A stage that fits the format: itself, or the nearest earlier stage of the format's flow. */
export function stageForFormat(stage, format) {
  if (stage === 'Publicado') return stage;
  const flow = stageFlows[format];
  return flow.includes(stage) ? stage : flow.filter(s => stages.indexOf(s) <= stages.indexOf(stage)).at(-1);
}
export function emptyState() {
  return {
    schemaVersion: 1,
    workspaces: [{ id: 'studio-live', name: 'Meu estúdio', timezone: 'America/Sao_Paulo' }],
    channels: [],
    connections: [],
    contents: [],
    metrics: [],
    plans: [],
    comments: [],
    reports: [],
    videoReports: [],
    playlists: [],
    financial: [],
    membershipSnapshots: [],
    syncJobs: [],
  };
}
