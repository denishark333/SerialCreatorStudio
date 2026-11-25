import { useState, type ReactNode } from 'react';
import { Target } from 'lucide-react';
import { AnimatedNumber } from '../DataMotion';
import { num, studioRequest } from '../studioApi';

/**
 * Progress towards a goal (YouTube subscribers by default; Twitch/Kick followers or paid subscribers).
 * `subscribers` is the current value, null when a selected channel hides it: then no progress is shown (never an
 * invented number), with `unavailable` as the explanation when there is one.
 */
export function SubscriberGoal({
  goal,
  subscribers,
  onSaved,
  onError,
  metric,
  unit = 'inscritos',
  subtitle = 'Canais YouTube selecionados',
  unavailable,
  children,
}: {
  goal: number | null;
  subscribers: number | null;
  onSaved: (goal: number) => void;
  onError: (message: string) => void;
  /** Goal metric for the API (omitted: YouTube subscribers). */
  metric?: string;
  /** What is counted, in the plural ("inscritos", "seguidores", "assinantes"). */
  unit?: string;
  subtitle?: string;
  /** Why the current value is missing (e.g. the platform's API does not provide it). */
  unavailable?: string;
  /** Extra controls under the heading (metric picker). */
  children?: ReactNode;
}) {
  // The field follows the saved goal whenever it changes (same render, no empty flash).
  const [target, setTarget] = useState(String(goal ?? ''));
  const [shownGoal, setShownGoal] = useState(goal);
  if (goal !== shownGoal) {
    setShownGoal(goal);
    setTarget(String(goal ?? ''));
  }
  const ratio = goal && subscribers !== null ? Math.min(100, (subscribers / goal) * 100) : 0;
  return (
    <section className="panel next-panel overview-goal">
      <div className="section-head">
        <div>
          <h2>Sua próxima meta</h2>
          <p>{subtitle}</p>
        </div>
        <Target size={19} />
      </div>
      {children}
      {goal && subscribers !== null ? (
        <div className="goal-content">
          <div
            className="goal-ring"
            style={{
              background: `conic-gradient(var(--accent) calc(var(--ring-progress,1) * ${ratio}%),var(--line) 0)`,
            }}
          >
            <span>
              <AnimatedNumber value={ratio} format={num} />%
            </span>
          </div>
          <div>
            <strong>
              <AnimatedNumber value={subscribers} format={num} /> de <AnimatedNumber value={goal} format={num} />
            </strong>
            <p className="footnote">
              Faltam <AnimatedNumber value={Math.max(0, goal - subscribers)} format={num} />
            </p>
          </div>
        </div>
      ) : subscribers === null && unavailable ? (
        <p className="api-note">{unavailable}</p>
      ) : (
        <p className="api-note">Defina uma meta de {unit} para acompanhar sua evolução.</p>
      )}
      <form
        className="goal-form"
        onSubmit={e => {
          e.preventDefault();
          const next = Number(target);
          void studioRequest('subscriber-goal', {
            method: 'PATCH',
            body: metric ? { target: next, metric } : { target: next },
          })
            .then(() => onSaved(next))
            .catch(error => onError(error.message));
        }}
      >
        <input
          aria-label={'Meta de ' + unit}
          type="number"
          min="1"
          max="1000000000"
          required
          value={target}
          placeholder="Ex.: 10000"
          onChange={e => setTarget(e.target.value)}
        />
        <button>Salvar meta</button>
      </form>
    </section>
  );
}
