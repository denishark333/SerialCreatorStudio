import { Bar, BarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { AnimatedNumber } from '../DataMotion';
import type { Report } from '../liveTypes';
import { num } from '../studioApi';

type Ranked = Report['topContents'][number];

/** Channel-wide daily views (all formats) and the top 3 contents of the period. */
export function ChannelActivity({
  report,
  topContents,
  onOpen,
}: {
  report: Report;
  topContents: Ranked[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="panel next-panel">
      <div className="section-head">
        <div>
          <h2>Atividade do canal</h2>
          <p>Views diárias · todos os formatos</p>
        </div>
        <span className="glass-tag">YouTube</span>
      </div>
      <strong className="big-number">
        <AnimatedNumber value={report.summary.views} format={num} />
        <span>views no período</span>
      </strong>
      {report.timeseries.length ? (
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={report.timeseries}>
            <Tooltip
              contentStyle={{ background: 'var(--panel-solid)', border: '1px solid var(--line)', borderRadius: 10 }}
            />
            <Bar
              isAnimationActive={false}
              dataKey="YouTube"
              name="Visualizações"
              fill="var(--accent)"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="api-note">Nenhuma série coletada neste intervalo.</p>
      )}
      <p className="footnote">
        {report.dataThrough ? 'Dados até ' + report.dataThrough : 'Sincronize os relatórios acima.'}
      </p>
      <div className="overview-activity-ranking">
        {topContents.slice(0, 3).map(v => (
          <button
            key={v.channelId + v.externalId}
            onClick={() => {
              if (v.id) onOpen(v.id);
            }}
            disabled={!v.id}
          >
            {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" />}
            <strong>{v.title}</strong>
            <b>
              <AnimatedNumber value={v.views} format={num} />
            </b>
          </button>
        ))}
      </div>
    </section>
  );
}
