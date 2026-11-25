import { ArrowRight } from 'lucide-react';
import { AnimatedNumber } from '../DataMotion';
import { RetentionChart } from '../RetentionChart';
import { timeLabel } from '../retention';
import { num, type Details, type Video } from '../studioApi';

/** Latest publication of the selected format, with its retention curve. */
export function OverviewHero({
  latest,
  featured,
  catalogLoaded,
  contentFormat,
  onOpenReport,
}: {
  latest: Video | null;
  featured: Details | null;
  catalogLoaded: boolean;
  contentFormat: 'Vídeo' | 'Short';
  onOpenReport: (video: Video) => void;
}) {
  const short = contentFormat === 'Short';
  return (
    <section
      className="panel overview-hero"
      style={
        latest?.thumbnailUrl
          ? {
              backgroundImage: `linear-gradient(0deg,rgba(6,12,18,.98),rgba(6,12,18,.12)),url(${latest.thumbnailUrl})`,
            }
          : {}
      }
    >
      <span className="overview-duration">{latest?.duration}</span>
      <span className="glass-tag">
        {short ? 'Último Short' : 'Último vídeo'} ·{' '}
        {latest?.date ?? (catalogLoaded ? 'Nenhuma publicação neste formato' : 'Carregando catálogo')}
      </span>
      <div>
        <h2>
          {latest?.title ??
            (catalogLoaded
              ? short
                ? 'Nenhum Short importado'
                : 'Nenhum vídeo importado'
              : 'Carregando publicação...')}
        </h2>
        <div className="hero-metrics">
          <div>
            <strong>
              <AnimatedNumber value={latest?.views} format={num} />
            </strong>
            <span>views totais</span>
          </div>
          <div>
            <strong>
              {typeof featured?.summary?.averageViewPercentage === 'number' ? (
                <AnimatedNumber value={featured.summary.averageViewPercentage} format={v => num(v) + '%'} />
              ) : (
                '—'
              )}
            </strong>
            <span>média assistida</span>
          </div>
          <div>
            <strong>
              {typeof featured?.summary?.averageViewDuration === 'number' ? (
                <AnimatedNumber value={featured.summary.averageViewDuration} format={timeLabel} />
              ) : (
                '—'
              )}
            </strong>
            <span>duração média</span>
          </div>
          <div>
            <strong>
              <AnimatedNumber value={latest?.likes} format={num} />
            </strong>
            <span>curtidas</span>
          </div>
        </div>
        <div className="overview-retention">
          <RetentionChart
            rows={featured?.report?.retention.rows ?? latest?.retentionCurve ?? []}
            duration={latest?.duration}
            reason={
              featured?.report?.retention.reason ??
              (!catalogLoaded
                ? 'Carregando o conteúdo em destaque...'
                : !latest
                  ? 'Nenhum conteúdo deste formato foi importado.'
                  : null)
            }
          />
        </div>
        {latest ? (
          <button onClick={() => onOpenReport(latest)}>
            Abrir relatório {short ? 'do Short' : 'do vídeo'} <ArrowRight size={15} />
          </button>
        ) : (
          <a href="#/content" className="primary">
            Abrir Conteúdo
          </a>
        )}
      </div>
    </section>
  );
}
