import { ArrowRight } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { Revenue } from '../liveTypes';
import { money } from '../studioApi';

/** Estimated YouTube revenue (USD) grouped by month within the selected range. */
export function MonthlyRevenue({ entries }: { entries: Revenue['entries'] | undefined }) {
  const months = new Map<string, number>();
  for (const e of entries ?? []) months.set(e.date.slice(0, 7), (months.get(e.date.slice(0, 7)) ?? 0) + e.amount);
  return (
    <section className="panel next-panel">
      <div className="section-head">
        <div>
          <h2>Receita por mês</h2>
          <p>Estimativa no intervalo · USD</p>
        </div>
        <a href="#/revenue">
          Receitas <ArrowRight size={14} />
        </a>
      </div>
      {months.size ? (
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={[...months].map(([date, amount]) => ({ date, amount }))}>
            <XAxis dataKey="date" tick={{ fill: 'var(--muted)', fontSize: 9 }} />
            <Tooltip
              formatter={v => money(Number(v))}
              contentStyle={{ background: 'var(--panel-solid)', border: '1px solid var(--line)', borderRadius: 10 }}
            />
            <Bar
              isAnimationActive={false}
              dataKey="amount"
              name="Receita estimada"
              fill="var(--accent)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="api-note">Sem receita disponível. Consulte a cobertura na aba Receitas.</p>
      )}
    </section>
  );
}
