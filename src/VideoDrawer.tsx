import { AnimatedNumber } from './DataMotion';
import { trafficLabel } from './trafficLabels';
import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import { studioRequest, num, money, type Details, type Video } from './studioApi';
export function Spark({ values, color = '#00e4e3' }: { values: number[]; color?: string }) {
  if (!values.length) return <span className="muted">—</span>;
  const max = Math.max(...values, 1),
    min = Math.min(...values);
  const path = values
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'} ${values.length === 1 ? 50 : (i / (values.length - 1)) * 100} ${27 - ((v - min) / (max - min || 1)) * 23}`,
    )
    .join(' ');
  return (
    <svg className="studio-spark" viewBox="0 0 100 30" aria-label="Evolução registrada">
      <path d={path} stroke={color} fill="none" strokeWidth="2" />
    </svg>
  );
}
export function VideoDrawer({
  video,
  from,
  to,
  onClose,
  onChanged,
}: {
  video: Video;
  from: string;
  to: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<Details | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const items = panel.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],select:not(:disabled),input:not(:disabled),textarea',
        );
        const first = items[0],
          last = items[items.length - 1];
        if (!first) return;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = overflow;
      removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const f = () => setRevision(v => v + 1);
    addEventListener('serial-data-updated', f);
    return () => removeEventListener('serial-data-updated', f);
  }, []);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    (async () => {
      try {
        let d = await studioRequest<Details>(`contents/${video.id}/details`, { params: { from, to } });
        if (active) setDetail(d);
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [video.id, from, to, revision]);

  const d = detail ?? video,
    s = detail?.summary,
    report = detail?.report;
  function plot(section: 'retention' | 'daily', key: string, label: string) {
    const source = report?.[section];
    return (
      <section className="drawer-section">
        <h3>{label}</h3>
        {source?.rows.length ? (
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart
              data={source.rows.map(row => ({
                ...row,
                value: section === 'retention' ? Number(row[key]) * 100 : Number(row[key]),
                position: section === 'retention' ? Number(row.elapsedVideoTimeRatio) * 100 : row.day,
              }))}
            >
              <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
              <XAxis
                dataKey="position"
                tick={{ fontSize: 9, fill: 'var(--muted)' }}
                tickFormatter={v => (section === 'retention' ? v + '%' : String(v).slice(5))}
                minTickGap={30}
              />
              <YAxis width={35} tick={{ fontSize: 9, fill: 'var(--muted)' }} />
              <Tooltip
                contentStyle={{ background: 'var(--panel-solid)', borderRadius: 10, border: '1px solid var(--line)' }}
              />
              <Area
                isAnimationActive={false}
                dataKey="value"
                name={section === 'retention' ? 'Razão de audiência (%)' : 'Visualizações'}
                stroke="var(--accent)"
                fill="#b4f50012"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="drawer-unavailable">
            {busy
              ? 'Consultando relatório…'
              : (source?.reason ??
                (d.platform !== 'YouTube'
                  ? 'Relatório não disponibilizado pela API desta plataforma.'
                  : 'Aguardando coleta global ou dados indisponíveis neste período.'))}
          </p>
        )}
      </section>
    );
  }
  const traffic = report?.traffic.rows ?? [],
    trafficTotal = traffic.reduce((n, r) => n + Number(r.views), 0);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        ref={panel}
        tabIndex={-1}
        className="video-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={'Relatório de ' + video.title}
        onClick={e => e.stopPropagation()}
      >
        <header>
          <div>
            <h2>{d.title}</h2>
            <p>
              {d.format} · {d.date} · {d.duration}
            </p>
          </div>
          <button className="icon" aria-label="Fechar relatório" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="drawer-content">
          {d.thumbnailUrl && <img className="drawer-cover" src={d.thumbnailUrl} alt="" />}
          <p className="footnote">
            Relatório de {from} a {to} ·{' '}
            {busy
              ? 'Carregando…'
              : report
                ? 'Coletado ' + new Date(report.fetchedAt).toLocaleString('pt-BR')
                : 'Ainda não coletado'}
          </p>
          {error && (
            <p className="api-error" role="alert">
              {error}
            </p>
          )}
          <div className="drawer-metrics">
            <div>
              <strong>
                <AnimatedNumber value={s?.views ?? d.views} format={num} />
              </strong>
              <small>{s ? 'Views no período' : 'Views totais'}</small>
            </div>
            <div>
              <strong>
                {s?.estimatedMinutesWatched == null ? (
                  '—'
                ) : (
                  <AnimatedNumber value={s.estimatedMinutesWatched / 60} format={v => num(v) + ' h'} />
                )}
              </strong>
              <small>Tempo assistido</small>
            </div>
            <div>
              <strong>
                {s?.averageViewPercentage == null ? (
                  '—'
                ) : (
                  <AnimatedNumber value={s.averageViewPercentage} format={v => num(v) + '%'} />
                )}
              </strong>
              <small>Média assistida</small>
            </div>
            <div>
              <strong>
                <AnimatedNumber
                  value={report?.revenue.rows[0]?.estimatedRevenue as number | undefined}
                  format={money}
                />
              </strong>
              <small>Estimado · USD</small>
            </div>
          </div>
          <p className="footnote">Atualizado pela sincronização global, junto dos demais conteúdos.</p>
          {plot('retention', 'audienceWatchRatio', 'Quem fica, e em qual trecho')}
          <p className="footnote">Razão de reprodução por trecho. Repetições podem elevar o valor acima de 100%.</p>
          {plot('daily', 'views', 'Visualizações por dia')}
          <section className="drawer-section">
            <h3>De onde vieram as visualizações</h3>
            {traffic.length ? (
              <>
                {traffic.map(r => (
                  <div className="traffic-row" key={String(r.insightTrafficSourceType)}>
                    <span>{trafficLabel(String(r.insightTrafficSourceType))}</span>
                    <div className="retention">
                      <span style={{ width: (trafficTotal ? (Number(r.views) / trafficTotal) * 100 : 0) + '%' }} />
                    </div>
                    <b>
                      <AnimatedNumber value={trafficTotal ? (Number(r.views) / trafficTotal) * 100 : 0} format={num} />%
                    </b>
                  </div>
                ))}
              </>
            ) : (
              <p className="drawer-unavailable">{report?.traffic.reason ?? 'Sem origens de tráfego disponíveis.'}</p>
            )}
          </section>
          <section className="drawer-section">
            <h3>Detalhes</h3>
            <dl>
              <div>
                <dt>Visibilidade</dt>
                <dd>{d.status}</dd>
              </div>
              <div>
                <dt>Publicação</dt>
                <dd>{d.date}</dd>
              </div>
              <div>
                <dt>Duração</dt>
                <dd>{d.duration}</dd>
              </div>
              <div>
                <dt>Curtidas · comentários</dt>
                <dd>
                  <AnimatedNumber value={d.likes} format={num} /> · <AnimatedNumber value={d.comments} format={num} />
                </dd>
              </div>
              <div>
                <dt>Receita / mil views</dt>
                <dd>
                  {s?.views && report?.revenue.rows[0]?.estimatedRevenue != null ? (
                    <AnimatedNumber
                      value={(Number(report.revenue.rows[0].estimatedRevenue) / s.views) * 1000}
                      format={money}
                    />
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>
            <a
              className="primary"
              href={
                d.platform === 'YouTube'
                  ? `https://studio.youtube.com/video/${encodeURIComponent(d.externalId)}/edit`
                  : d.watchUrl
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              {d.platform === 'YouTube' ? 'Editar título e visibilidade' : 'Abrir na plataforma'}{' '}
              <ExternalLink size={14} />
            </a>
          </section>
        </div>
      </aside>
    </div>
  );
}
