import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Wallet } from 'lucide-react';
import { AnimatedNumber } from '../DataMotion';
import type { Memberships } from '../Members';
import type { Revenue } from '../liveTypes';
import { money, num, type Video } from '../studioApi';
import { MembershipRevenue } from './FinanceSummary';

const tooltipStyle = { background: 'var(--panel-solid)', border: '1px solid var(--line)', borderRadius: 10 };

/** "Ganhos" tab: estimated YouTube revenue (per month and per upload) and paying members. */
export function FinanceEarnings({
  revenue,
  memberships,
  uploads,
}: {
  revenue: Revenue | null;
  memberships: Memberships | null;
  uploads: Video[];
}) {
  const [visible, setVisible] = useState(true);
  const monthly = new Map<string, number>();
  for (const e of revenue?.entries ?? [])
    monthly.set(e.date.slice(0, 7), (monthly.get(e.date.slice(0, 7)) ?? 0) + e.amount);
  const chart = [...monthly].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <>
      <div className="stats">
        {[
          ['YouTube · estimado', <AnimatedNumber value={revenue?.amount} format={money} />, 'mint'],
          ['Membros pagantes', <AnimatedNumber value={memberships?.total} format={num} />, 'lavender'],
          ['Parcerias', 'Registro manual', 'sand'],
          ['Loja', 'Não integrada', 'peach'],
        ].map(([label, value, color]) => (
          <article className={'stat ' + color} key={String(label)}>
            <span>
              <Wallet size={14} />
              {label}
            </span>
            <strong className="finance-value">{value}</strong>
            <small className="muted">
              {label === 'YouTube · estimado' ? 'USD · período selecionado' : 'Consulte a fonte correspondente'}
            </small>
          </article>
        ))}
      </div>
      <MembershipRevenue value={memberships} />
      <section className="panel chart-panel">
        <div className="section-head">
          <div>
            <h2>Receita estimada por mês</h2>
            <p>Valores retornados no intervalo selecionado · USD</p>
          </div>
          <button className={visible ? 'accent' : ''} onClick={() => setVisible(!visible)}>
            YouTube
          </button>
        </div>
        {chart.length ? (
          <ResponsiveContainer width="100%" height={270}>
            <AreaChart data={chart}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: 'var(--muted)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 10 }} />
              <Tooltip formatter={v => money(Number(v))} contentStyle={tooltipStyle} />
              {visible && (
                <Area
                  isAnimationActive={false}
                  dataKey="amount"
                  name="YouTube"
                  stroke="#00e4e3"
                  fill="#00e4e315"
                  strokeWidth={2}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty">Nenhuma receita disponível no período selecionado.</div>
        )}
        <p className="footnote">Não representa saldo de AdSense ou pagamentos confirmados.</p>
      </section>
      <section className="panel chart-panel">
        <h2>Receita por upload</h2>
        {uploads.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={uploads.map(v => ({ title: v.title, amount: v.estimatedRevenue }))}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="title" tick={{ fill: 'var(--muted)', fontSize: 9 }} minTickGap={35} />
              <Tooltip formatter={v => money(Number(v))} contentStyle={tooltipStyle} />
              <Bar
                isAnimationActive={false}
                dataKey="amount"
                name="Estimado (USD)"
                fill="var(--accent)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="api-note">
            A sincronização global coleta as receitas por vídeo neste intervalo. O gráfico mostra apenas os dados já
            coletados.
          </p>
        )}
      </section>
    </>
  );
}
