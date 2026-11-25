import type { ApiPlan, ApiPlanInput, ApiPlanStage, Platform } from '../api';

/** Production stages, in order. After 'Pronto' the plan is published ('Publicado'). */
export const stages = ['Ideia', 'Roteiro', 'Gravação', 'Edição', 'Pronto'] as const satisfies readonly ApiPlanStage[];
export const PUBLISHED: ApiPlanStage = 'Publicado';
/** Every stage a plan can be in (pipeline columns). */
export const allStages: ApiPlanStage[] = [...stages, PUBLISHED];
export const formats = ['Vídeo', 'Short', 'VOD', 'Clip', 'Live'] as const;
export const weekdays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

/** A YYYY-MM-DD day as a local Date at noon (safe from DST/timezone day shifts). */
export function date(value: string) {
  return new Date(value + 'T12:00:00');
}
/** Local Date → YYYY-MM-DD. */
export function key(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
export function monthStart(value: string) {
  return value.slice(0, 7) + '-01';
}
export function addMonths(month: string, delta: number) {
  const next = date(month);
  next.setMonth(next.getMonth() + delta);
  return key(next);
}
/** The 6 × 7 days shown for a month, starting on Monday. */
export function grid(value: string) {
  const start = date(value);
  start.setDate(1 - ((start.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return key(day);
  });
}
/** Monday-first weekday index (0 = Seg … 6 = Dom) of a YYYY-MM-DD day. */
export function weekdayIndex(value: string) {
  return (date(value).getDay() + 6) % 7;
}
/** "hoje", "amanhã", "ontem", "em 6 dias", "há 2 dias". */
export function relativeDay(value: string, today: string) {
  const days = Math.round((date(value).getTime() - date(today).getTime()) / 86400000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days === -1) return 'ontem';
  return days > 0 ? `em ${days} dias` : `há ${-days} dias`;
}
/** "sáb., 7 de nov. · 18:00 · em 6 dias" */
export function scheduleLabel(day: string, time: string | null | undefined, today: string) {
  const label = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).format(
    date(day),
  );
  return [label, time, relativeDay(day, today)].filter(Boolean).join(' · ');
}
type Format = ApiPlanInput['format'];
/**
 * Production stages per format (same rule as the API): a live is not recorded or edited beforehand, and VODs/clips
 * come from a live that already happened, so they only need editing.
 */
export const stageFlows: Record<Format, ApiPlanStage[]> = {
  Vídeo: ['Ideia', 'Roteiro', 'Gravação', 'Edição', 'Pronto'],
  Short: ['Ideia', 'Roteiro', 'Gravação', 'Edição', 'Pronto'],
  Live: ['Ideia', 'Roteiro', 'Pronto'],
  VOD: ['Ideia', 'Edição', 'Pronto'],
  Clip: ['Ideia', 'Edição', 'Pronto'],
};
export const flowOf = (format: Format) => stageFlows[format] ?? stageFlows.Vídeo;
/** Whether a plan of this format can be in this stage ('Publicado' always). */
export const stageFits = (stage: ApiPlanStage, format: Format) => stage === PUBLISHED || flowOf(format).includes(stage);
/** A stage that fits the format: itself, or the nearest earlier stage of the format's flow. */
export function stageForFormat(stage: ApiPlanStage, format: Format): ApiPlanStage {
  if (stageFits(stage, format)) return stage;
  const order = allStages.indexOf(stage);
  return (
    flowOf(format)
      .filter(s => allStages.indexOf(s) <= order)
      .at(-1) ?? 'Ideia'
  );
}
/** The next production stage, or null when the plan is ready (next step: publish). */
export function nextStage(stage: ApiPlanStage, format: Format): ApiPlanStage | null {
  const flow = flowOf(format),
    i = flow.indexOf(stage);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
}
export function previousStage(stage: ApiPlanStage, format: Format): ApiPlanStage | null {
  if (stage === PUBLISHED) return 'Pronto';
  const flow = flowOf(format),
    i = flow.indexOf(stage);
  return i > 0 ? flow[i - 1] : null;
}
/** Filled steps of the stage track (a published plan fills every step). */
export function stageProgress(stage: ApiPlanStage, format: Format) {
  const flow = flowOf(format);
  return stage === PUBLISHED ? flow.length : flow.indexOf(stage) + 1;
}
/** How a stage reads for the format: a live has a "pauta" (not a script) and is not "published", it happens. */
export function stageLabel(stage: ApiPlanStage, format: Format) {
  if (format !== 'Live') return stage;
  return stage === PUBLISHED ? 'Realizada' : stage === 'Roteiro' ? 'Pauta' : stage;
}
/**
 * Audience by weekday from daily views: average views per weekday, scaled 0..1 (Mon-first).
 * Null when there are fewer than 4 weeks of days with views (too little to say anything).
 */
export function weekdayAudience(rows: { date: string; views: number }[]): number[] | null {
  const sums = Array(7).fill(0),
    counts = Array(7).fill(0);
  for (const row of rows) {
    if (!(row.views > 0)) continue;
    const i = weekdayIndex(row.date);
    sums[i] += row.views;
    counts[i]++;
  }
  if (counts.some(c => c < 4)) return null;
  const averages = sums.map((s, i) => s / counts[i]),
    min = Math.min(...averages),
    max = Math.max(...averages);
  return averages.map(v => (max > min ? (v - min) / (max - min) : 0.5));
}
/** Every channel of a plan, the primary first (older plans only have `channelId`). */
export const planChannelIds = (plan: { channelId: string; channelIds?: string[] | null }) =>
  plan.channelIds?.length ? plan.channelIds : [plan.channelId];
/** Platforms where a plan happens (several = multistream). */
export function planPlatforms(plan: ApiPlan): Platform[] {
  return plan.platforms?.length ? [...new Set(plan.platforms)] : [plan.platform];
}
export const isMultistream = (plan: ApiPlan) => plan.format === 'Live' && planChannelIds(plan).length > 1;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/**
 * Other plans on the same day within an hour of this one: the calendar is shared by every platform, so a live and
 * a video at the same time would compete. Plans without a time never conflict.
 */
export function timeConflicts(
  target: { id?: string; date: string; time?: string | null },
  plans: ApiPlan[],
): ApiPlan[] {
  if (!target.time) return [];
  const at = minutes(target.time);
  return plans.filter(
    p => p.id !== target.id && p.date === target.date && p.time && Math.abs(minutes(p.time) - at) < 60,
  );
}
