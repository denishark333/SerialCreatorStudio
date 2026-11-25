import { ArrowRight } from 'lucide-react';
import type { Report } from '../liveTypes';
import { flowOf, stageLabel, stageProgress } from '../planner/calendar';
import { PlanCover } from '../planner/PlanCover';

/** The next planned content: animated cover (stage icon, platforms, date and title) and its production stage. */
export function NextPlan({ plans }: { plans: Report['nextPlans'] }) {
  return (
    <section className="panel next-panel">
      <div className="section-head">
        <div>
          <h2>Próximo conteúdo</h2>
          <p>Do seu planejamento</p>
        </div>
        <a href="#/planner">
          Planejar <ArrowRight size={14} />
        </a>
      </div>
      {plans?.length ? (
        plans.slice(0, 1).map(p => (
          <div key={p.id}>
            <PlanCover plan={p} />
            <div className="stages">
              {flowOf(p.format).map((s, i) => (
                <div key={s} className={i < stageProgress(p.stage, p.format) ? 'done' : ''}>
                  <i />
                  <span>{stageLabel(s, p.format)}</span>
                </div>
              ))}
            </div>
            <p className="footnote">
              {p.format} · {stageLabel(p.stage, p.format)}
            </p>
          </div>
        ))
      ) : (
        <p className="api-note">Nenhum conteúdo futuro planejado.</p>
      )}
    </section>
  );
}
