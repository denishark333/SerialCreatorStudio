import { useId, useState, useEffect } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowUpRight, BadgeDollarSign, Gem, MessageSquare, UserPlus } from 'lucide-react';
import type { Platform } from './api';
import { AnimatedNumber } from './DataMotion';
import { num, studioRequest } from './studioApi';
import type { LiveSession } from './overview/LiveSessions';

type Day = {
  date: string;
  lives: number;
  minutes: number;
  avgViewers: number | null;
  peakViewers: number | null;
  minutesWatched: number;
  followers: number | null;
  subs: number;
  bits: number;
  chatters: number;
  raids: number;
};
export type StreamReport = {
  from: string;
  to: string;
  dataSince: string | null;
  totals: {
    lives: number;
    minutes: number;
    avgViewers: number | null;
    peakViewers: number | null;
    minutesWatched: number;
    followers: number | null;
    subs: number;
    bits: number;
    chatters: number;
    raids: number;
    raidViewers: number;
  };
  days: Day[];
  games: { game: string; lives: number; minutes: number; avgViewers: number | null }[];
  raiders: { name: string; login: string | null; raids: number; viewers: number }[];
  sessions: (LiveSession & { thumbnailUrl: string | null })[];
  coverage: {
    channelId: string;
    name: string;
    status: string;
    reason: string | null;
    fetchedAt: string | null;
    since: string | null;
  }[];
  tracking: { events: boolean; chat: boolean };
};

// Same palette and helpers as the YouTube analytics, so both read as one product.
const colors = ['#b9f500', '#00d6d3', '#a67af5', '#f5c774', '#8eabd8'];
const hours = (minutes: number) => {
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
};
const shortDate = (value: string) =>
  new Date(value + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Ranked list with a share bar, like "De onde assistem" on YouTube. */
function Ranked({ items, empty }: { items: { label: string; value: number; href?: string }[]; empty: string }) {
  const total = items.reduce((n, v) => n + v.value, 0);
  if (!items.length) return <div className="analytics-empty">{empty}</div>;
  return (
    <>
      {items.slice(0, 10).map((v, i) => (
        <div className="analytics-rank" key={v.label}>
          <small>{i + 1}</small>
          <span title={v.label}>
            {v.href ? (
              <a href={v.href} target="_blank" rel="noopener noreferrer">
                {v.label}
              </a>
            ) : (
              v.label
            )}
          </span>
          <div className="retention">
            <span style={{ width: (total ? (v.value / total) * 100 : 0) + '%' }} />
          </div>
          <b>{total ? <AnimatedNumber value={(v.value / total) * 100} format={x => num(x) + '%'} /> : '—'}</b>
        </div>
      ))}
    </>
  );
}

type EngagementMetric = {
  key: 'followers' | 'subs' | 'bits' | 'chatters';
  title: string;
  label: string;
  icon: typeof UserPlus;
  total: number | null;
};

/** Engagement tab: daily chart per metric and the lives that engaged the most (same layout as YouTube). */
function StreamEngagement({ report, twitch }: { report: StreamReport; twitch: boolean }) {
  const metrics: EngagementMetric[] = [
    {
      key: 'followers',
      title: 'Seguidores ganhos por dia',
      label: 'Seguidores',
      icon: UserPlus,
      total: report.totals.followers,
    },
    ...(twitch
      ? ([
          {
            key: 'subs',
            title: 'Inscrições por dia',
            label: 'Inscrições',
            icon: BadgeDollarSign,
            total: report.totals.subs,
          },
          { key: 'bits', title: 'Bits por dia', label: 'Bits', icon: Gem, total: report.totals.bits },
          {
            key: 'chatters',
            title: 'Participantes do chat por dia',
            label: 'Chat',
            icon: MessageSquare,
            total: report.totals.chatters,
          },
        ] satisfies EngagementMetric[])
      : []),
  ];
  const [metric, setMetric] = useState<EngagementMetric['key']>('followers'),
    gradient = useId().replace(/:/g, ''),
    selected = metrics.find(v => v.key === metric) ?? metrics[0];
  const series = report.days.map(d => ({ date: d.date, value: d[selected.key] ?? null })),
    available = series.some(row => row.value !== null && row.value !== 0);
  const ranked = report.sessions
      .filter(s => s.avgViewers)
      .map(s => ({
        ...s,
        score:
          (((s.chat?.chatters ?? 0) + (s.followersGained ?? 0) * 2 + (s.subs + s.resubs + s.gifts) * 5) /
            (s.avgViewers as number)) *
          100,
      }))
      .filter(s => s.score > 0)
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
              <strong>
                {selected.total == null ? '—' : <AnimatedNumber key={metric} value={selected.total} format={num} />}
              </strong>
              <span> no período</span>
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
          <div key={metric} className="engagement-plot" role="img" aria-label={selected.title}>
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
                  tickFormatter={shortDate}
                  minTickGap={40}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                />
                <YAxis
                  width={58}
                  tickFormatter={v => num(Number(v))}
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                />
                <Tooltip
                  labelFormatter={v => shortDate(String(v))}
                  formatter={v => [num(Number(v)), selected.label]}
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
          <h2>Lives que mais engajaram</h2>
          <p>
            {twitch
              ? '(Participantes do chat + seguidores ganhos × 2 + inscrições × 5) ÷ média de espectadores.'
              : 'Seguidores ganhos × 2 ÷ média de espectadores.'}
          </p>
        </header>
        {ranked.length ? (
          <ol>
            {ranked.map((live, i) => (
              <li key={live.id}>
                <span className="engagement-position">{i + 1}</span>
                <div className="engagement-video">
                  {live.thumbnailUrl && <img src={live.thumbnailUrl} alt="" loading="lazy" />}
                  <div>
                    <strong>{live.title || 'Live'}</strong>
                    <small>
                      {shortDate(live.date)} · {num(live.followersGained ?? 0)} seguidores
                      {twitch &&
                        ` · ${num(live.chat?.chatters ?? 0)} no chat · ${num(live.subs + live.resubs + live.gifts)} inscrições`}
                    </small>
                  </div>
                </div>
                <div className="engagement-score">
                  <div>
                    <span style={{ width: (live.score / max) * 100 + '%' }} />
                  </div>
                  <strong>
                    <AnimatedNumber value={live.score} format={num} />%
                  </strong>
                </div>
                <span className="engagement-open" aria-hidden="true">
                  <ArrowUpRight size={17} />
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="engagement-empty">
            Ainda não há lives com interações registradas suficientes para montar este ranking.
          </div>
        )}
        {ranked.length > 0 && (
          <p className="footnote">Índice ponderado, não percentual de espectadores únicos; pode ultrapassar 100%.</p>
        )}
      </section>
    </div>
  );
}

/**
 * Analytics of a live-streaming platform (Twitch, Kick) with the same tabs and cards as the YouTube analytics,
 * filled with what the Dashboard stores: viewers sampled by every sync, followers counted by it and (Twitch) subs,
 * bits, raids and chat received in real time.
 */
export function StreamAnalytics({
  platform,
  channelIds,
  from,
  to,
  revision,
}: {
  platform: Platform;
  channelIds: string[];
  from: string;
  to: string;
  revision: number;
}) {
  const [report, setReport] = useState<StreamReport | null>(null),
    [error, setError] = useState(''),
    [tab, setTab] = useState('Audiência');
  const scope = channelIds.join(',');
  useEffect(() => {
    let active = true;
    setError('');
    studioRequest<StreamReport>('streams/analytics', { params: { channelId: scope.split(','), from, to } })
      .then(r => active && setReport(r))
      .catch(e => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [scope, from, to, revision]);
  if (error)
    return (
      <p role="alert" className="api-error">
        {error}
      </p>
    );
  if (!report) return <p className="api-note">Carregando analytics…</p>;
  const twitch = platform === 'Twitch';
  // Audience: average viewers per weekday (weighted by minutes streamed).
  const weekdays = WEEKDAYS.map((label, i) => {
    const days = report.days.filter(d => d.avgViewers !== null && new Date(d.date + 'T12:00:00Z').getUTCDay() === i);
    const minutes = days.reduce((n, d) => n + d.minutes, 0);
    return {
      label,
      value: minutes ? Math.round(days.reduce((n, d) => n + (d.avgViewers ?? 0) * d.minutes, 0) / minutes) : 0,
    };
  });
  const gameTotal = report.games.reduce((n, g) => n + g.minutes, 0);
  const liveDays = report.days.filter(d => d.lives > 0).length,
    ratio = report.days.length ? (liveDays / report.days.length) * 100 : null;
  const maxDay = Math.max(1, ...report.days.map(d => d.avgViewers ?? 0));
  const daily = report.days.map(d => ({ date: d.date, value: d.avgViewers }));
  const top = [...report.sessions].sort((a, b) => (b.minutesWatched ?? 0) - (a.minutesWatched ?? 0)).slice(0, 15);
  const watchedByGame = new Map<string, number>();
  for (const s of report.sessions)
    if (s.game) watchedByGame.set(s.game, (watchedByGame.get(s.game) ?? 0) + (s.minutesWatched ?? 0));
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
        {report.from} — {report.to} · Datas: America/Sao_Paulo
        {report.dataSince && report.dataSince > report.from ? ' · Dados desde ' + report.dataSince : ''}
      </p>
      {tab === 'Audiência' && (
        <>
          <div className="analytics-three">
            <section className="panel analytics-card">
              <h2>Dias da semana</h2>
              <p>Média de espectadores nas lives de cada dia</p>
              {weekdays.some(d => d.value) ? (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={weekdays}>
                    <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis width={35} tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip formatter={v => [num(Number(v)), 'Média de espectadores']} />
                    <Bar isAnimationActive={false} dataKey="value" name="Espectadores" radius={[4, 4, 0, 0]}>
                      {weekdays.map((v, i) => (
                        <Cell key={v.label} fill={colors[0]} fillOpacity={0.35 + i * 0.09} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="analytics-empty">Nenhuma live registrada neste período.</div>
              )}
            </section>
            <section className="panel analytics-card">
              <h2>De onde chegam</h2>
              <p>{twitch ? 'Raids recebidas · espectadores trazidos' : 'Raids recebidas'}</p>
              {twitch ? (
                <Ranked
                  items={report.raiders.map(r => ({
                    label: r.name,
                    value: r.viewers,
                    href: r.login ? 'https://www.twitch.tv/' + r.login : undefined,
                  }))}
                  empty="Nenhuma raid recebida no período."
                />
              ) : (
                <div className="analytics-empty">A API da Kick não informa raids.</div>
              )}
            </section>
            <section className="panel analytics-card">
              <h2>Jogos e categorias</h2>
              <p>Como o tempo ao vivo foi dividido</p>
              <div className="device-segments">
                {report.games.map((g, i) => (
                  <span
                    key={g.game}
                    title={g.game + ': ' + hours(g.minutes)}
                    style={{
                      width: (gameTotal ? (g.minutes / gameTotal) * 100 : 0) + '%',
                      background: colors[i % colors.length],
                    }}
                  />
                ))}
              </div>
              <div className="device-legend">
                {report.games.map((g, i) => (
                  <span key={g.game}>
                    <i style={{ background: colors[i % colors.length] }} />
                    {g.game}{' '}
                    {gameTotal ? (
                      <AnimatedNumber value={(g.minutes / gameTotal) * 100} format={v => num(v) + '%'} />
                    ) : (
                      '—'
                    )}
                  </span>
                ))}
              </div>
              {!report.games.length && <p className="analytics-empty">Sem jogos registrados no período.</p>}
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
                      {ratio === null ? '—' : <AnimatedNumber value={ratio} format={v => num(v) + '%'} />}
                    </strong>
                    <small>dias com live</small>
                  </div>
                </div>
                <p>
                  {num(liveDays)} de {num(report.days.length)} dias com transmissão · {hours(report.totals.minutes)} ao
                  vivo no período.
                </p>
              </div>
            </section>
          </div>
          <section className="panel calendar-activity">
            <div className="section-head">
              <div>
                <h2>Atividade diária da audiência</h2>
                <p>Média de espectadores em cada dia do período</p>
              </div>
              <small>
                <AnimatedNumber value={report.totals.avgViewers} format={num} /> de média
              </small>
            </div>
            <div className="daily-heatmap">
              {report.days.map(d => (
                <div
                  key={d.date}
                  className={d.avgViewers === null ? 'missing' : ''}
                  style={
                    d.avgViewers === null
                      ? {}
                      : {
                          background: `color-mix(in srgb,var(--accent) ${Math.max(6, (d.avgViewers / maxDay) * 75)}%,transparent)`,
                        }
                  }
                  title={
                    d.date + ': ' + (d.avgViewers === null ? 'sem live' : num(d.avgViewers) + ' espectadores em média')
                  }
                >
                  <small>
                    {d.date.slice(8)}/{d.date.slice(5, 7)}
                  </small>
                  <strong>
                    <AnimatedNumber value={d.avgViewers} format={num} />
                  </strong>
                </div>
              ))}
            </div>
            <p className="footnote">
              Intensidade relativa à média de espectadores do período. Dias sem live ficam sem valor. A média vem das
              coletas a cada 30 min.
            </p>
          </section>
        </>
      )}
      {tab === 'Alcance' && (
        <>
          <div className="analytics-two">
            <section className="panel analytics-card">
              <h2>Jogos e categorias</h2>
              <p>Participação nos minutos assistidos (estimados)</p>
              <Ranked
                items={[...watchedByGame].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)}
                empty="Sem jogos registrados no período."
              />
            </section>
            <section className="panel analytics-card">
              <h2>Espectadores por dia</h2>
              {report.totals.lives ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={daily}>
                    <CartesianGrid vertical={false} stroke="var(--line)" />
                    <XAxis dataKey="date" minTickGap={40} tick={{ fontSize: 10 }} />
                    <YAxis width={40} />
                    <Tooltip formatter={v => [num(Number(v)), 'Média de espectadores']} />
                    <Area
                      isAnimationActive={false}
                      dataKey="value"
                      name="Média de espectadores"
                      stroke="#00d6d3"
                      fill="#00d6d3"
                      fillOpacity={0.12}
                      connectNulls={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="analytics-empty">Sem série disponível.</div>
              )}
            </section>
          </div>
          <section className="panel analytics-card">
            <h2>Lives com maior alcance</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Live</th>
                    <th>Minutos assistidos</th>
                    <th>Média</th>
                    <th>Pico</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map(s => (
                    <tr key={s.id}>
                      <td>
                        <span className="video-cell">
                          {s.thumbnailUrl && (
                            <img className="analytics-thumb" src={s.thumbnailUrl} alt="" loading="lazy" />
                          )}
                          <strong>
                            {s.title || 'Live'}
                            <small>
                              {' '}
                              · {shortDate(s.date)} · {[s.game, hours(s.minutes)].filter(Boolean).join(' · ')}
                            </small>
                          </strong>
                        </span>
                      </td>
                      <td>
                        <AnimatedNumber value={s.minutesWatched} format={num} />
                      </td>
                      <td>
                        <AnimatedNumber value={s.avgViewers} format={num} />
                      </td>
                      <td>
                        <AnimatedNumber value={s.peakViewers} format={num} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!top.length && <p className="analytics-empty">Nenhuma live no período.</p>}
            </div>
          </section>
        </>
      )}
      {tab === 'Engajamento' && <StreamEngagement report={report} twitch={twitch} />}
      <details className="panel analytics-coverage">
        <summary>Cobertura e atualização dos dados</summary>
        {report.coverage.map(c => (
          <div key={c.channelId}>
            <strong>{c.name}</strong>
            <span>{c.status === 'available' ? 'Disponível' : 'Aguardando coleta'}</span>
            {c.reason && <p>{c.reason}</p>}
            {c.fetchedAt && <small>Coletado em {new Date(c.fetchedAt).toLocaleString('pt-BR')}</small>}
          </div>
        ))}
        <div>
          <strong>Fora da API da {platform}</strong>
          <span>Não disponibilizado pela API</span>
          <p>
            Origem do tráfego, localização, plataforma de quem assiste e espectadores únicos ficam só no painel da{' '}
            {platform}.
          </p>
        </div>
      </details>
    </div>
  );
}
