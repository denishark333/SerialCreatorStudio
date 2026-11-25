import { AnimatedNumber } from './DataMotion';
import { useId, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ThumbsUp, MessageSquare, Share2, UserPlus, ArrowUpRight } from 'lucide-react';
import type { Report } from './liveTypes';
const metrics = [
  { key: 'likes', title: 'Curtidas por dia', label: 'Curtidas', icon: ThumbsUp },
  { key: 'comments', title: 'Comentários por dia', label: 'Comentários', icon: MessageSquare },
  { key: 'shares', title: 'Compartilhamentos por dia', label: 'Compartilhamentos', icon: Share2 },
  { key: 'subscribersGained', title: 'Inscritos ganhos por dia', label: 'Inscritos ganhos', icon: UserPlus },
] as const;
const number = (value: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
const date = (value: string) =>
  new Date(value + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export function EngagementAnalytics({ report }: { report: Report }) {
  const [metric, setMetric] = useState<(typeof metrics)[number]['key']>('likes'),
    gradient = useId().replace(/:/g, ''),
    selected = metrics.find(v => v.key === metric)!;
  const series = report.timeseries.map(row => ({ date: row.date, value: row[metric] ?? null })),
    available = series.some(row => row.value !== null),
    total = report.summary[metric];
  const ranked = report.topContents
      .filter(v => v.views > 0 && v.likes != null && v.comments != null && v.shares != null)
      .map(v => ({ ...v, score: ((v.likes! + v.comments! * 4 + v.shares! * 6) / v.views) * 100 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10),
    max = Math.max(1, ...ranked.map(v => v.score));
  return (
    <div className="engagement-layout">
      <section className="panel engagement-chart">
        <header className="engagement-heading">
          <div>
            <h2>{selected.title}</h2>
            <p>
              <strong>{total == null ? '—' : <AnimatedNumber key={metric} value={total} format={number} />}</strong>
              <span> nos últimos 30 dias</span>
            </p>
          </div>
          <div className="engagement-metrics" role="group" aria-label="Métrica de engajamento">
            {metrics.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                aria-pressed={metric === key}
                className={metric === key ? 'selected' : ''}
                onClick={() => setMetric(key)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        </header>
        {available ? (
          <div key={metric} className="engagement-plot" role="img" aria-label={selected.title + ' nos últimos 30 dias'}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 16, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 4" />
                <XAxis
                  dataKey="date"
                  tickFormatter={date}
                  minTickGap={40}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                />
                <YAxis
                  width={58}
                  tickFormatter={number}
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                />
                <Tooltip
                  labelFormatter={v => date(String(v))}
                  formatter={v => [number(Number(v)), selected.label]}
                  contentStyle={{ background: 'var(--panel-solid)', border: '1px solid var(--line)', borderRadius: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  name={selected.label}
                  stroke="var(--accent)"
                  strokeWidth={2.3}
                  fill={'url(#' + gradient + ')'}
                  connectNulls={false}
                  isAnimationActive={false}
                  activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--panel-solid)', strokeWidth: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="engagement-empty">Sem série diária disponível para esta métrica no período.</div>
        )}
      </section>
      <section className="panel engagement-ranking">
        <header>
          <h2>Conteúdos que mais geraram conversa</h2>
          <p>(Curtidas + comentários × 4 + compartilhamentos × 6) ÷ visualizações do período.</p>
        </header>
        {ranked.length ? (
          <ol>
            {ranked.map((video, i) => (
              <li key={video.channelId + video.externalId}>
                <span className="engagement-position">{i + 1}</span>
                <a className="engagement-video" href={'#/content?video=' + encodeURIComponent(video.externalId)}>
                  {video.thumbnailUrl && <img src={video.thumbnailUrl} alt="" loading="lazy" />}
                  <div>
                    <strong>{video.title}</strong>
                    <small>
                      <AnimatedNumber value={video.likes!} format={number} /> curtidas ·{' '}
                      <AnimatedNumber value={video.comments!} format={number} /> comentários ·{' '}
                      <AnimatedNumber value={video.shares!} format={number} /> compartilhamentos
                    </small>
                  </div>
                </a>
                <div className="engagement-score">
                  <div>
                    <span style={{ width: (video.score / max) * 100 + '%' }} />
                  </div>
                  <strong>
                    <AnimatedNumber value={video.score} format={number} />%
                  </strong>
                </div>
                <a
                  className="engagement-open"
                  href={'#/content?video=' + encodeURIComponent(video.externalId)}
                  aria-label={'Abrir relatório de ' + video.title}
                >
                  <ArrowUpRight size={17} />
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <div className="engagement-empty">
            Os relatórios sincronizados ainda não têm interações por vídeo suficientes para montar este ranking.
          </div>
        )}
        {ranked.length > 0 && (
          <p className="footnote">
            Índice ponderado, não percentual de espectadores únicos. Somente conteúdos com as três métricas disponíveis;
            valores podem ultrapassar 100%.
          </p>
        )}
      </section>
    </div>
  );
}
