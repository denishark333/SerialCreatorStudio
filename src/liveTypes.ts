import type { ApiPlan } from './api';
export type Coverage = {
  channelId: string;
  name: string;
  status: string;
  reason: string | null;
  fetchedAt?: string | null;
};
export type Audience = {
  status: string;
  items: { label: string; views: number }[];
  coverage: { channelId: string; status: string; reason: string | null }[];
};
export type Report = {
  status: string;
  period: { from: string; to: string };
  timezone: string;
  dataThrough: string | null;
  coverage: Coverage[];
  summary: {
    views: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    subscribers: number | null;
    watchTimeMinutes: number | null;
    engagementRate: number | null;
    subscribersGained: number | null;
    subscribersLost: number | null;
  };
  timeseries: {
    date: string;
    YouTube: number;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    subscribersGained?: number | null;
    subscribersLost?: number | null;
  }[];
  topContents: {
    id: string | null;
    externalId: string;
    channelId: string;
    title: string;
    thumbnailUrl: string | null;
    views: number;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    averageViewPercentage: number | null;
    dailyViews?: { day: string; views: number }[] | null;
    retentionCurve?: { elapsedVideoTimeRatio: number; audienceWatchRatio: number }[] | null;
  }[];
  audience: {
    countries: Audience;
    devices: Audience;
    subscribed?: Audience;
    ages?: { status: string; items: { label: string; percentage: number }[]; reason?: string | null };
  };
  traffic?: Audience;
  catalogCount?: number;
  lifetimeViews?: number | null;
  latestContent?: {
    title: string;
    thumbnailUrl: string;
    views: number | null;
    watchUrl: string;
    publishedAt: string;
  } | null;
  nextPlans?: ApiPlan[];
};
export type Revenue = {
  status: string;
  currency: string;
  amount: number | null;
  coverage: Coverage[];
  reason: string;
  entries: { channelId: string; date: string; amount: number; currency: string; nature: string }[];
};
