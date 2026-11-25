import { AnimatedNumber } from './DataMotion';
import { EngagementAnalytics } from './EngagementAnalytics';
import { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
} from 'recharts';
import type { Report, Audience } from './liveTypes';
const colors = ['#b9f500', '#00d6d3', '#a67af5', '#f5c774', '#8eabd8'];
const number = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v);
const names: Record<string, string> = {
  MOBILE: 'Celular',
  DESKTOP: 'Computador',
  TV: 'TV',
  TABLET: 'Tablet',
  GAME_CONSOLE: 'Console',
  UNKNOWN_PLATFORM: 'Outros',
  SUBSCRIBED: 'Inscritos',
  UNSUBSCRIBED: 'Não inscritos',
  YT_SEARCH: 'Pesquisa do YouTube',
  RELATED_VIDEO: 'Vídeos sugeridos',
  EXT_URL: 'Sites externos',
  SUBSCRIBER: 'Página inicial / inscrições',
  YT_CHANNEL: 'Páginas de canais',
  SHORTS: 'Feed de Shorts',
  NO_LINK_OTHER: 'Direto ou desconhecido',
  PLAYLIST: 'Playlists',
  YT_OTHER_PAGE: 'Outras páginas do YouTube',
  NOTIFICATION: 'Notificações',
};
const country = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
function label(v: string) {
  try {
    return names[v] ?? (/^[A-Z]{2}$/.test(v) ? country.of(v) : v) ?? v;
  } catch {
    return v;
  }
}
function Ranked({ value }: { value: Audience | undefined }) {
  const total = value?.items.reduce((n, v) => n + v.views, 0) ?? 0;
  return (
    <>
      {value?.items.slice(0, 10).map((v, i) => (
        <div className="analytics-rank" key={v.label}>
          <small>{i + 1}</small>
          <span title={label(v.label)}>{label(v.label)}</span>
          <div className="retention">
            <span style={{ width: (total ? (v.views / total) * 100 : 0) + '%' }} />
          </div>
          <b>{total ? <AnimatedNumber value={(v.views / total) * 100} format={v => number(v) + '%'} /> : '—'}</b>
        </div>
      ))}
      {!value?.items.length && (
        <div className="analytics-empty">A plataforma não retornou dados para este período.</div>
      )}
      {value?.status === 'partial' && (
        <small className="footnote">Cobertura parcial: percentuais sobre os resultados disponíveis.</small>
      )}
    </>
  );
}
export function StudioAnalytics({ report }: { report: Report }) {
  const [tab, setTab] = useState('Audiência');
  const devices = report.audience.devices,
    total = devices.items.reduce((n, v) => n + v.views, 0);
  const sub = report.audience.subscribed,
    subTotal = sub?.items.reduce((n, v) => n + v.views, 0) ?? 0,
    subViews = sub?.items.find(v => v.label === 'SUBSCRIBED')?.views ?? 0,
    ratio = subTotal ? (subViews / subTotal) * 100 : null;
  const max = Math.max(1, ...report.timeseries.map(v => v.YouTube));
  const daily = new Map(report.timeseries.map(v => [v.date, v.YouTube]));
  const days = [];
  for (
    let d = new Date(report.period.from + 'T12:00:00Z');
    d <= new Date(report.period.to + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1)
  )
    days.push(d.toISOString().slice(0, 10));
  return (
    <div className="analytics-studio">
      <div className="tabs">
        {['Audiência', 'Alcance', 'Engajamento'].map(v => (
          <button className={tab === v ? 'selected' : ''} key={v} onClick={() => setTab(v)}>
            {v}
          </button>
        ))}
      </div>
      <p className="footnote">
        {report.period.from} — {report.period.to} · Datas do YouTube: {report.timezone}
        {report.dataThrough ? ' · Dados até ' + report.dataThrough : ''}
      </p>
      {tab === 'Audiência' && (
        <>
          <div className="analytics-three">
            <section className="panel analytics-card">
              <h2>Idade</h2>
              <p>Percentual de espectadores identificados</p>
              {report.audience.ages?.items.length ? (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={report.audience.ages.items}>
                    <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickFormatter={v => String(v).replace('age', '')} tick={{ fontSize: 10 }} />
                    <YAxis unit="%" width={35} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={v => number(Number(v)) + '%'} />
                    <Bar isAnimationActive={false} dataKey="percentage" name="Espectadores" radius={[4, 4, 0, 0]}>
                      {report.audience.ages.items.map((v, i) => (
                        <Cell key={v.label} fill={colors[0]} fillOpacity={0.35 + i * 0.09} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="analytics-empty">
                  {report.audience.ages?.reason ??
                    'Sem dados demográficos. O YouTube exige um volume mínimo de audiência para este relatório.'}
                </div>
              )}
            </section>
            <section className="panel analytics-card">
              <h2>De onde assistem</h2>
              <p>Países · visualizações retornadas</p>
              <Ranked value={report.audience.countries} />
            </section>
            <section className="panel analytics-card">
              <h2>Dispositivos</h2>
              <p>Como sua audiência acompanha o canal</p>
              <div className="device-segments">
                {devices.items.map((v, i) => (
                  <span
                    key={v.label}
                    title={label(v.label) + ': ' + number(v.views)}
                    style={{
                      width: (total ? (v.views / total) * 100 : 0) + '%',
                      background: colors[i % colors.length],
                    }}
                  />
                ))}
              </div>
              <div className="device-legend">
                {devices.items.map((v, i) => (
                  <span key={v.label}>
                    <i style={{ background: colors[i % colors.length] }} />
                    {label(v.label)}{' '}
                    {total ? <AnimatedNumber value={(v.views / total) * 100} format={v => number(v) + '%'} /> : '—'}
                  </span>
                ))}
              </div>
              {!devices.items.length && <p className="analytics-empty">Sem distribuição disponível.</p>}
              <div className="audience-return">
                <div
                  className="audience-donut"
                  style={{
                    background:
                      ratio === null
                        ? 'var(--line)'
                        : `conic-gradient(var(--accent) calc(var(--ring-progress,1) * ${ratio}%),var(--line) 0)`,
                  }}
                >
                  <div>
                    <strong>
                      {ratio === null ? '—' : <AnimatedNumber value={ratio} format={v => number(v) + '%'} />}
                    </strong>
                    <small>de inscritos</small>
                  </div>
                </div>
                <p>
                  Participação dos inscritos nas visualizações do período. Essa medida não representa espectadores
                  recorrentes.
                </p>
              </div>
            </section>
          </div>
          <section className="panel calendar-activity">
            <div className="section-head">
              <div>
                <h2>Atividade diária da audiência</h2>
                <p>Visualizações registradas em cada dia do período</p>
              </div>
              <small>
                <AnimatedNumber value={report.summary.views} format={number} /> views
              </small>
            </div>
            <div className="daily-heatmap">
              {days.map(date => {
                const value = daily.get(date);
                return (
                  <div
                    key={date}
                    className={value === undefined ? 'missing' : ''}
                    style={
                      value === undefined
                        ? {}
                        : {
                            background: `color-mix(in srgb,var(--accent) ${Math.max(6, (value / max) * 75)}%,transparent)`,
                          }
                    }
                    title={date + ': ' + (value === undefined ? 'não retornado' : number(value) + ' visualizações')}
                  >
                    <small>
                      {date.slice(8)}/{date.slice(5, 7)}
                    </small>
                    <strong>
                      <AnimatedNumber value={value} format={number} />
                    </strong>
                  </div>
                );
              })}
            </div>
            <p className="footnote">
              Intensidade relativa às visualizações do período. Dias sem linha retornada ficam sem valor. A API
              utilizada não disponibiliza o mapa de presença por hora exibido no YouTube Studio.
            </p>
          </section>
        </>
      )}
      {tab === 'Alcance' && (
        <>
          <div className="analytics-two">
            <section className="panel analytics-card">
              <h2>Origem do tráfego</h2>
              <p>Participação nas visualizações retornadas</p>
              <Ranked value={report.traffic} />
            </section>
            <section className="panel analytics-card">
              <h2>Visualizações por dia</h2>
              {report.timeseries.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={report.timeseries}>
                    <CartesianGrid vertical={false} stroke="var(--line)" />
                    <XAxis dataKey="date" minTickGap={40} tick={{ fontSize: 10 }} />
                    <YAxis width={40} />
                    <Tooltip />
                    <Area
                      isAnimationActive={false}
                      dataKey="YouTube"
                      name="Visualizações"
                      stroke="#00d6d3"
                      fill="#00d6d3"
                      fillOpacity={0.12}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="analytics-empty">Sem série disponível.</div>
              )}
            </section>
          </div>
          <section className="panel analytics-card">
            <h2>Conteúdos com maior alcance</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Conteúdo</th>
                    <th>Visualizações</th>
                    <th>Média assistida</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topContents.slice(0, 15).map(c => (
                    <tr key={c.channelId + c.externalId}>
                      <td>
                        <a className="video-cell" href={'#/content?video=' + encodeURIComponent(c.externalId)}>
                          {c.thumbnailUrl && (
                            <img className="analytics-thumb" src={c.thumbnailUrl} alt="" loading="lazy" />
                          )}
                          <strong>{c.title}</strong>
                        </a>
                      </td>
                      <td>
                        <AnimatedNumber value={c.views} format={number} />
                      </td>
                      <td>
                        {c.averageViewPercentage == null ? (
                          '—'
                        ) : (
                          <AnimatedNumber value={c.averageViewPercentage} format={v => number(v) + '%'} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report.topContents.length && <p className="analytics-empty">Nenhum resultado no período.</p>}
            </div>
          </section>
        </>
      )}
      {tab === 'Engajamento' && <EngagementAnalytics report={report} />}
      <details className="panel analytics-coverage">
        <summary>Cobertura e atualização dos dados</summary>
        {report.coverage.map(c => (
          <div key={c.channelId}>
            <strong>{c.name}</strong>
            <span>
              {(
                {
                  available: 'Disponível',
                  no_data: 'Sem dados',
                  not_synced: 'Aguardando coleta',
                  unsupported: 'Não disponibilizado pela API',
                  unavailable: 'Indisponível',
                  reauthorization_required: 'Reconecte o canal',
                } as Record<string, string>
              )[c.status] ?? c.status}
            </span>
            {c.reason && <p>{c.reason}</p>}
            {c.fetchedAt && <small>Coletado em {new Date(c.fetchedAt).toLocaleString('pt-BR')}</small>}
          </div>
        ))}
      </details>
    </div>
  );
}
