import { dataFetch } from './dataCache';
import { apiBase } from './apiConfig';
import type { Report as LiveReport, Revenue as LiveRevenue } from './liveTypes';
/** Contract for the independent Serial API. No application secret belongs in Vite env. */
export type ApiMeta = { requestId: string; mode: 'live'; dataSource: 'platforms'; generatedAt: string };
export type ApiResponse<T> = { data: T; meta: ApiMeta };
export type ApiPage<T> = ApiResponse<T[]> & {
  pagination: { page: number; limit: number; total: number; totalPages: number };
};
export type Platform = 'YouTube' | 'Twitch' | 'Kick';
export type ApiChannel = {
  id: string;
  workspaceId: string;
  connectionId: string | null;
  externalId: string;
  name: string;
  thumbnailUrl?: string | null;
  platform: Platform;
  subscribers: number | null;
  followers?: number | null;
  paidSubscribers?: number | null;
  watchUrl?: string;
  live?: { isLive: boolean; viewers: number | null; title?: string };
  catalogStatus?: string;
  warnings?: { section: string; reason: string }[];
  lastSyncedAt: string | null;
  dataSource: 'youtube' | 'twitch' | 'kick';
};
export type ApiContent = {
  id: string;
  workspaceId: string;
  channelId: string;
  externalId: string;
  platform: Platform;
  title: string;
  format: string;
  date: string;
  duration: string;
  image: string;
  thumbnailUrl: string;
  status: string;
  views: number | null;
  periodViews: number | null;
  likes?: number | null;
  comments?: number | null;
  watchUrl?: string;
  retention: number | null;
  dataSource: 'youtube' | 'twitch' | 'kick';
  lastSyncedAt: string | null;
};
export type ApiPlanInput = {
  title: string;
  channelId: string;
  format: 'Vídeo' | 'Short' | 'VOD' | 'Clip' | 'Live';
  date: string;
  stage?: ApiPlanStage;
  /** Publication time, HH:MM (local). */
  time?: string | null;
  notes?: string;
  /** Every channel of the plan, the primary first; several only for a live (multistream). */
  channelIds?: string[];
  /** Linked brand deal (Receita → Negociações). */
  dealId?: string | null;
  /** Published video linked by hand (otherwise matched by title once the plan is ready). */
  contentId?: string | null;
};
export type ApiPlanStage = 'Ideia' | 'Roteiro' | 'Gravação' | 'Edição' | 'Pronto' | 'Publicado';
export type ApiPlan = ApiPlanInput & {
  id: string;
  workspaceId: string;
  platform: Platform;
  stage: ApiPlanStage;
  channelIds?: string[];
  /** Platforms of the plan's channels (several = multistream). */
  platforms?: Platform[];
  deal?: { id: string; title: string; amountCents: number; currency: string; stage: string } | null;
  content?: {
    id: string;
    title: string;
    date: string | null;
    thumbnailUrl: string | null;
    watchUrl: string | null;
    views: number | null;
    /** Game streamed (Twitch/Kick lives), when known. */
    game?: string | null;
    /** How it was linked: picked by hand, by the brand deal's keywords, or automatically (same day/title). */
    linked: 'manual' | 'deal' | 'auto';
  } | null;
  createdAt: string;
  updatedAt: string;
};
/** Published content (or a live seen by the sync) that no plan claims, shown on the planner calendar. */
export type ApiPlanRecord = {
  id: string;
  kind: 'content' | 'live';
  channelId: string;
  platform: Platform;
  title: string;
  format: string;
  date: string;
  time: string | null;
  thumbnailUrl: string | null;
  watchUrl: string | null;
  views: number | null;
  game: string | null;
  /** The confirmed brand deal this content delivers (keywords within the deal's window). */
  deal: { id: string; title: string } | null;
};
export type ApiSummary = {
  views: number;
  subscribers: number | null;
  subscribersBasis: 'current_total';
  watchTimeMinutes: number;
  engagementRate: number | null;
  comparison: null;
};
export type ApiAnalytics = {
  period: { from: string; to: string };
  summary: ApiSummary;
  timeseries: { date: string; YouTube: number; Twitch: number; Kick: number }[];
  byPlatform: { platform: Platform; views: number }[];
  availability: { audience: { status: string; reason: string }; revenue: { status: string; reason: string } };
};
export type ApiOverview = ApiAnalytics & {
  latestContent: ApiContent | null;
  topContents: ApiContent[];
  nextPlans: ApiPlan[];
  lastSyncedAt: string | null;
};
export type ApiReply = { id: string; text: string; createdAt: string; delivery: 'local_only' | 'published' };
export type ApiComment = {
  id: string;
  workspaceId: string;
  channelId: string;
  contentId: string;
  platform: Platform;
  author: string;
  text: string;
  hearted: boolean;
  replies: ApiReply[];
  dataSource: 'youtube' | 'twitch' | 'kick';
  publishedAt?: string;
  likeCount?: number;
  replyCount?: number;
  videoId?: string;
  externalId?: string;
};
export type ApiFilters = {
  platform?: Platform;
  channelId?: string[];
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  q?: string;
  format?: string;
  sort?: 'date' | 'views' | 'retention';
};
export class SerialApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function createSerialApi(baseUrl = apiBase, getToken?: () => string | undefined) {
  async function request<T>(path: string, filters: ApiFilters = {}, method = 'GET', body?: unknown): Promise<T> {
    const url = new URL(path, baseUrl);
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined)
        (Array.isArray(value) ? value : [value]).forEach(v => url.searchParams.append(key, String(v)));
    });
    const token = getToken?.();
    const response = await dataFetch(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return undefined as T;
    const payload = await response.json();
    if (!response.ok)
      throw new SerialApiError(
        response.status,
        payload.error?.code ?? 'HTTP_ERROR',
        payload.error?.message ?? 'Falha ao consultar API',
      );
    return payload as T;
  }
  const root = (workspace: string) => `/api/v1/workspaces/${encodeURIComponent(workspace)}`;
  return {
    workspaces: () => request<ApiResponse<{ id: string; name: string; timezone: string }[]>>('/api/v1/workspaces'),
    channels: (w: string, f?: ApiFilters) => request<ApiPage<ApiChannel>>(root(w) + '/channels', f),
    overview: (w: string, f?: ApiFilters) => request<ApiResponse<ApiOverview | LiveReport>>(root(w) + '/overview', f),
    contents: (w: string, f?: ApiFilters) => request<ApiPage<ApiContent>>(root(w) + '/contents', f),
    content: (w: string, id: string, f?: ApiFilters) =>
      request<ApiResponse<ApiContent & { retentionCurve: null; diagnosis: { status: string; reason: string } }>>(
        root(w) + '/contents/' + encodeURIComponent(id),
        f,
      ),
    analytics: (w: string, f?: ApiFilters) =>
      request<ApiResponse<ApiAnalytics | LiveReport>>(root(w) + '/analytics', f),
    plans: (w: string, f?: ApiFilters) => request<ApiPage<ApiPlan>>(root(w) + '/plans', f),
    createPlan: (w: string, body: ApiPlanInput) => request<ApiResponse<ApiPlan>>(root(w) + '/plans', {}, 'POST', body),
    updatePlan: (w: string, id: string, body: Partial<ApiPlanInput>) =>
      request<ApiResponse<ApiPlan>>(root(w) + '/plans/' + encodeURIComponent(id), {}, 'PATCH', body),
    deletePlan: (w: string, id: string) => request<void>(root(w) + '/plans/' + encodeURIComponent(id), {}, 'DELETE'),
    revenue: (w: string, f?: ApiFilters) =>
      request<
        ApiResponse<
          | LiveRevenue
          | { status: 'not_connected'; totals: unknown[]; entries: unknown[]; payouts: unknown[]; reason: string }
        >
      >(root(w) + '/revenue', f),
    comments: (w: string, f?: ApiFilters) => request<ApiPage<ApiComment>>(root(w) + '/community/comments', f),
    connections: (w: string) =>
      request<
        ApiResponse<{
          items: unknown[];
          providers: {
            platform: Platform;
            status: string;
            oauth: boolean;
            catalog: boolean;
            analytics: boolean;
            revenue: boolean;
            management: boolean;
            reason: string;
          }[];
        }>
      >(root(w) + '/connections'),
  };
}
