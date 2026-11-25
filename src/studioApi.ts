import { dataFetch } from './dataCache';
import { apiSession } from './apiSession';
import type { ApiContent, ApiChannel, ApiComment, Platform } from './api';

import { apiBase } from './apiConfig';
export { apiBase } from './apiConfig';
export type Filters = Record<string, string | string[] | number | undefined>;
export type Page<T> = { data: T[]; pagination: { page: number; limit: number; total: number; totalPages: number } };
export type Video = ApiContent & {
  tags?: string[];
  description?: string;
  formatClassification?: string;
  averageViewPercentage: number | null;
  estimatedRevenue: number | null;
  retentionCurve?: { elapsedVideoTimeRatio: number; audienceWatchRatio: number }[] | null;
  dailyViews?: { day: string; views: number }[] | null;
};
export type VideoReport = { status: string; rows: Record<string, number | string>[]; reason: string | null };
export type Details = Video & {
  period: { from: string; to: string };
  summary: Record<string, number> | null;
  report: {
    summary: VideoReport;
    daily: VideoReport;
    retention: VideoReport;
    traffic: VideoReport;
    revenue: VideoReport;
    fetchedAt: string;
  } | null;
};
export type Playlist = {
  id: string;
  externalId: string;
  channelId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  itemCount: number;
  nextPageToken: string | null;
  items: { id: string; videoId: string; title: string; thumbnailUrl: string; position: number }[];
};
export type Comment = Omit<ApiComment, 'replies'> & {
  canReply?: boolean;
  membership?: {
    status: 'member' | 'not_member' | 'unknown';
    member: { name: string; levelName: string | null } | null;
    checkedAt: string | null;
  };
  repliesSyncStatus?: string;
  repliesError?: string | null;
  localHearted?: boolean;
  localPinned?: boolean;
  localHidden?: boolean;
  youtubeModerationStatus?: 'published' | 'heldForReview' | 'rejected';
  video: { id: string; title: string; thumbnailUrl: string } | null;
  replies: { id: string; text: string; delivery: string; createdAt: string; author?: string; isOwner?: boolean }[];
};
export type Financial = {
  id: string;
  channelId: string;
  title: string;
  type: 'payout' | 'deal';
  amountCents: number;
  currency: string;
  date: string;
  stage: string;
  source: 'manual';
  /** Brand deal: last day of the delivery window (one day when absent). */
  endDate?: string | null;
  /** Brand deal: words that recognise the content delivering it (title, tags or game). */
  keywords?: string[];
};
export async function studioRequest<T>(
  resource: string,
  {
    method = 'GET',
    body,
    params = {},
    list = false,
  }: { method?: string; body?: unknown; params?: Filters; list?: boolean } = {},
): Promise<T> {
  const url = new URL(`/api/v1/workspaces/${apiSession.workspaceId}/${resource}`, apiBase);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined) (Array.isArray(v) ? v : [v]).forEach(x => url.searchParams.append(k, String(x)));
  });
  let response;
  try {
    response = await dataFetch(url, {
      method,
      headers: {
        ...(apiSession.token ? { Authorization: 'Bearer ' + apiSession.token } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('Backend indisponível. Verifique se está em execução.');
  }
  if (response.status === 204) return undefined as T;
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(value.error?.message ?? 'Falha ao consultar API'), {
      code: value.error?.code as string | undefined,
      details: value.error?.details as unknown,
    });
  return (list ? value : value.data) as T;
}
export const num = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const money = (n: number | null | undefined, currency = 'USD') =>
  n == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(n);
export const dateToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export function daysAgo(to: string, days: number) {
  const date = new Date(to + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
export async function channels(platform?: Platform) {
  return (await studioRequest<Page<ApiChannel>>('channels', { params: { limit: 100, platform }, list: true })).data;
}
