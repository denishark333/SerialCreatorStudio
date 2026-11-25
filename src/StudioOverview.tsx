import { useEffect, useState } from 'react';
import { ArrowRight, TrendingUp } from 'lucide-react';
import type { ApiChannel } from './api';
import type { Report, Revenue } from './liveTypes';
import { studioRequest, type Details, type Video, type Comment, type Page } from './studioApi';
import { VideoDrawer } from './VideoDrawer';
import { ChannelActivity } from './overview/ChannelActivity';
import { CommunityQuestions } from './overview/CommunityQuestions';
import { FeaturedRanking } from './overview/FeaturedRanking';
import { MonthlyRevenue } from './overview/MonthlyRevenue';
import { NextPlan } from './overview/NextPlan';
import { OverviewHero } from './overview/OverviewHero';
import { OverviewStats } from './overview/OverviewStats';
import { SubscriberGoal } from './overview/SubscriberGoal';

/** YouTube overview: loads the data for the period and composes the sections in ./overview. */
export function StudioOverview({
  report,
  channels,
  from,
  to,
  contentFormat,
}: {
  report: Report;
  channels: ApiChannel[];
  from: string;
  to: string;
  contentFormat: 'Vídeo' | 'Short';
}) {
  const [catalog, setCatalog] = useState<Video[]>([]),
    [catalogLoaded, setCatalogLoaded] = useState(false),
    [revenue, setRevenue] = useState<Revenue | null>(null),
    [comments, setComments] = useState<Comment[]>([]),
    [goal, setGoal] = useState<number | null>(null),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<Video | null>(null),
    [detail, setDetail] = useState<Details | null>(null);

  // Revenue, community questions and subscriber goal for the selected channels.
  useEffect(() => {
    let active = true;
    setError('');
    const ids = report.coverage.map(c => c.channelId);
    Promise.allSettled([
      studioRequest<Revenue>('revenue', { params: { from, to, channelId: ids } }),
      studioRequest<Page<Comment>>('community/comments', {
        params: { channelId: ids, filter: 'questions', limit: 3 },
        list: true,
      }),
      studioRequest<{ target: number | null }>('subscriber-goal'),
    ]).then(([r, c, g]) => {
      if (!active) return;
      if (r.status === 'fulfilled') setRevenue(r.value);
      if (c.status === 'fulfilled') setComments(c.value.data);
      if (g.status === 'fulfilled') setGoal(g.value.target);
    });
    return () => {
      active = false;
    };
  }, [report, from, to]);

  // Whole catalog of the selected format (all pages), newest first.
  useEffect(() => {
    let active = true;
    setCatalogLoaded(false);
    const channelId = channels.map(c => c.id);
    (async () => {
      try {
        const params = { from, to, channelId, format: contentFormat, sort: 'date', limit: 100 };
        const first = await studioRequest<Page<Video>>('catalog', { params, list: true });
        const items = [...first.data];
        for (let page = 2; page <= first.pagination.totalPages; page++) {
          if (!active) return;
          items.push(
            ...(await studioRequest<Page<Video>>('catalog', { params: { ...params, page }, list: true })).data,
          );
        }
        if (active) {
          setCatalog(items.filter(v => v.platform === 'YouTube' && v.format === contentFormat));
          setCatalogLoaded(true);
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          setCatalogLoaded(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [contentFormat, from, to, report]);

  const latest = catalog[0] ?? null;
  const catalogIds = new Set(catalog.map(v => v.externalId));
  const topContents = report.topContents.filter(v => catalogIds.has(v.externalId));
  const featured = detail?.id === latest?.id ? detail : null;

  // Per-video report of the featured (latest) publication.
  useEffect(() => {
    let active = true;
    if (latest?.id)
      void studioRequest<Details>(`contents/${latest.id}/details`, { params: { from, to } })
        .then(v => {
          if (active) setDetail(v);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [latest?.id, from, to, report]);

  const youtubeChannels = channels.filter(c => c.platform === 'YouTube');
  const subscribers =
    youtubeChannels.length && youtubeChannels.every(c => c.subscribers !== null)
      ? youtubeChannels.reduce((n, c) => n + (c.subscribers ?? 0), 0)
      : null;

  async function open(id: string) {
    try {
      setSelected(await studioRequest<Video>(`contents/${id}/details`, { params: { from, to } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      {error && (
        <p className="api-error" role="alert">
          {error}
        </p>
      )}
      <div className="studio-heading-actions overview-page-actions">
        <div className="studio-action-row">
          <a href="#/analytics" className="button-link">
            Analytics <TrendingUp size={14} />
          </a>
          <a href="#/planner" className="primary">
            Criar conteúdo <ArrowRight size={14} />
          </a>
        </div>
      </div>
      <div className="home-grid overview-hero-grid">
        <OverviewHero
          latest={latest}
          featured={featured}
          catalogLoaded={catalogLoaded}
          contentFormat={contentFormat}
          onOpenReport={setSelected}
        />
        <ChannelActivity report={report} topContents={topContents} onOpen={id => void open(id)} />
      </div>
      <OverviewStats summary={report.summary} revenue={revenue?.amount} />
      <div className="home-grid studio-overview-grid">
        <div>
          <FeaturedRanking topContents={topContents} contentFormat={contentFormat} onOpen={id => void open(id)} />
          <CommunityQuestions comments={comments} />
        </div>
        <div>
          <NextPlan plans={report.nextPlans} />
          <SubscriberGoal goal={goal} subscribers={subscribers} onSaved={setGoal} onError={setError} />
          <MonthlyRevenue entries={revenue?.entries} />
        </div>
      </div>
      {selected && <VideoDrawer video={selected} from={from} to={to} onClose={() => setSelected(null)} />}
    </>
  );
}
