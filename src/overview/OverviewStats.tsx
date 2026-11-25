import { Clock, TrendingUp, Users, Wallet } from 'lucide-react';
import { AnimatedNumber } from '../DataMotion';
import type { Report } from '../liveTypes';
import { money, num } from '../studioApi';

/** Channel indicators for the last 30 days (all formats). Missing values render as "—", never 0. */
export function OverviewStats({
  summary,
  revenue,
}: {
  summary: Report['summary'];
  revenue: number | null | undefined;
}) {
  const stats = [
    { label: 'Inscritos atuais', value: summary.subscribers, format: num, icon: Users, color: 'peach' },
    { label: 'Views · 30 dias', value: summary.views, format: num, icon: TrendingUp, color: 'mint' },
    {
      label: 'Horas assistidas',
      value: summary.watchTimeMinutes === null ? null : summary.watchTimeMinutes / 60,
      format: num,
      icon: Clock,
      color: 'lavender',
    },
    { label: 'Receita estimada · USD', value: revenue, format: money, icon: Wallet, color: 'sand' },
  ];
  return (
    <>
      <div className="overview-channel-scope">Indicadores do canal · últimos 30 dias · todos os formatos</div>
      <div className="stats">
        {stats.map(v => (
          <article className={'stat ' + v.color} key={v.label}>
            <span>
              <v.icon size={15} />
              {v.label}
            </span>
            <strong>
              <AnimatedNumber value={v.value} format={(n: number) => v.format(n)} />
            </strong>
            <small className="muted">
              {v.label === 'Inscritos atuais'
                ? 'Total atual dos canais selecionados'
                : 'Período selecionado · última coleta'}
            </small>
          </article>
        ))}
      </div>
    </>
  );
}
