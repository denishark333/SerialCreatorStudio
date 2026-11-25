import { ArrowRight } from 'lucide-react';
import { AnimatedNumber } from '../DataMotion';
import type { Report } from '../liveTypes';
import { num } from '../studioApi';
import { Spark } from '../VideoDrawer';

type Ranked = Report['topContents'][number];

/** Top 5 contents of the selected format in the period, with retention and daily-views sparklines. */
export function FeaturedRanking({
  topContents,
  contentFormat,
  onOpen,
}: {
  topContents: Ranked[];
  contentFormat: 'Vídeo' | 'Short';
  onOpen: (id: string) => void;
}) {
  return (
    <section className="panel">
      <div className="section-head live-section-head">
        <div>
          <h2>{contentFormat === 'Short' ? 'Seus Shorts em destaque' : 'Seus vídeos em destaque'}</h2>
          <p>Ranking do período selecionado</p>
        </div>
        <a href="#/content">
          Todos os conteúdos <ArrowRight size={14} />
        </a>
      </div>
      {topContents.slice(0, 5).map((v, i) => (
        <button
          className="overview-ranking"
          key={v.channelId + v.externalId}
          onClick={() => {
            if (v.id) onOpen(v.id);
          }}
          disabled={!v.id}
        >
          <span>{i + 1}</span>
          {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" />}
          <div>
            <strong>{v.title}</strong>
            <small>
              {v.averageViewPercentage == null
                ? 'Média assistida indisponível'
                : num(v.averageViewPercentage) + '% assistido em média'}
            </small>
          </div>
          <div className="overview-mini-retention">
            <Spark values={v.retentionCurve?.map(r => r.audienceWatchRatio) ?? []} color="var(--accent)" />
          </div>
          <b>
            <AnimatedNumber value={v.views} format={num} />
            <small>views</small>
          </b>
          <Spark values={v.dailyViews?.map(r => r.views) ?? []} color="#d9dde5" />
        </button>
      ))}
      {!topContents.length && <div className="empty">Nenhum conteúdo retornado pelo relatório.</div>}
    </section>
  );
}
