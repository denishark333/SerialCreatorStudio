import { useState, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react';
import { BadgeDollarSign, CheckCircle2, Move, Plus } from 'lucide-react';
import type { ApiChannel, ApiPlan, ApiPlanRecord, ApiPlanStage } from '../api';
import { dateToday, money, type Financial } from '../studioApi';
import { PlatformDeck } from '../PlatformDeck';
import { PlatformIcon } from '../PlatformIcon';
import {
  allStages,
  date,
  flowOf,
  isMultistream,
  planPlatforms,
  PUBLISHED,
  stageFits,
  stageLabel,
  stageProgress,
  weekdayIndex,
  weekdays,
} from './calendar';

const channelName = (channels: ApiChannel[], plan: ApiPlan) => channels.find(c => c.id === plan.channelId)?.name;

/** Drag and drop shared by the calendar (drop on a day) and the pipeline (drop on a stage). */
export type PlanDrag = {
  /** The card being dragged, for styling (state: updates after the next render). */
  dragging: ApiPlan | null;
  /** The card being dragged, right now (a ref: valid during the very first dragover/drop events). */
  current: () => ApiPlan | null;
  onDragStart: (plan: ApiPlan) => void;
  onDragEnd: () => void;
};

/** A plan as a clickable, draggable card: cover (once published), format, time, title and stage progress. */
export function PlanChip({
  plan,
  channels,
  onOpen,
  drag,
}: {
  plan: ApiPlan;
  channels: ApiChannel[];
  onOpen: () => void;
  drag?: PlanDrag;
}) {
  const flow = flowOf(plan.format),
    progress = stageProgress(plan.stage, plan.format),
    published = plan.stage === PUBLISHED;
  function start(e: DragEvent) {
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', plan.id);
      e.dataTransfer.effectAllowed = 'move';
    }
    drag?.onDragStart(plan);
  }
  function key(e: KeyboardEvent) {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onOpen();
    }
  }
  // A div with role="button": browsers don't start an HTML5 drag from a <button> (Firefox).
  return (
    <div
      role="button"
      tabIndex={0}
      className={
        'planner-chip' +
        (published ? ' is-published' : progress === flow.length ? ' is-ready' : '') +
        (drag?.dragging?.id === plan.id ? ' is-dragging' : '')
      }
      draggable={Boolean(drag)}
      onDragStart={drag ? start : undefined}
      onDragEnd={drag?.onDragEnd}
      onClick={onOpen}
      onKeyDown={key}
    >
      {plan.content?.thumbnailUrl && (
        <img className="planner-chip-cover" src={plan.content.thumbnailUrl} alt="" loading="lazy" draggable={false} />
      )}
      <span className="planner-chip-where">
        <PlatformDeck platforms={planPlatforms(plan)} size={14} />
        {isMultistream(plan) ? (
          <span className="planner-multistream">MultiStream</span>
        ) : (
          <span className="planner-chip-channel">{channelName(channels, plan) ?? plan.platform}</span>
        )}
      </span>
      <span className="planner-chip-kind">
        {plan.format}
        {plan.time && (
          <>
            <i />
            {plan.time}
          </>
        )}
      </span>
      <strong>{plan.title}</strong>
      {plan.deal && (
        <span className="planner-chip-deal" title={'Publi: ' + plan.deal.title}>
          <BadgeDollarSign size={11} aria-hidden="true" />
          {plan.deal.title}
        </span>
      )}
      <span className="planner-chip-stage">
        {published && <CheckCircle2 size={11} aria-hidden="true" />}
        {stageLabel(plan.stage, plan.format)}
      </span>
      <span className="planner-stage-track" aria-label={'Etapa: ' + stageLabel(plan.stage, plan.format)}>
        {flow.map((stage, i) => (
          <i key={stage} className={i < progress ? 'filled' : ''} />
        ))}
      </span>
    </div>
  );
}

/**
 * Something already published (or a live seen by the sync) that no plan claims: filled in automatically, links to
 * the platform. Shows the game when known and the brand deal it delivered.
 */
export const recordDone = (record: ApiPlanRecord) =>
  record.format === 'Live' || record.format === 'VOD' ? 'Realizada' : 'Publicado';
function RecordChip({ record, onOpen }: { record: ApiPlanRecord; onOpen: () => void }) {
  const done = recordDone(record);
  return (
    <div
      role="button"
      tabIndex={0}
      className="planner-record"
      aria-label={`${record.title} (${done.toLowerCase()} na ${record.platform})`}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {record.thumbnailUrl && (
        <img className="planner-chip-cover" src={record.thumbnailUrl} alt="" loading="lazy" draggable={false} />
      )}
      <span className="planner-chip-where">
        <PlatformIcon platform={record.platform} size={13} />
        <span className="planner-chip-channel">
          {record.format}
          {record.time ? ' · ' + record.time : ''}
        </span>
      </span>
      <strong>{record.title}</strong>
      {record.game && <span className="planner-record-game">{record.game}</span>}
      {record.deal && (
        <span className="planner-chip-deal" title={'Publi entregue: ' + record.deal.title}>
          <BadgeDollarSign size={11} aria-hidden="true" />
          Publi entregue · {record.deal.title}
        </span>
      )}
      <span className="planner-chip-stage">
        <CheckCircle2 size={11} aria-hidden="true" />
        {done}
      </span>
    </div>
  );
}

type ViewProps = { plans: ApiPlan[]; channels: ApiChannel[]; onOpen: (plan: ApiPlan) => void };

/**
 * Drop-target handlers for a day cell / pipeline column; `id` names the target being hovered.
 * Always attached (a quick drag can drop before React re-renders), they only accept one of our cards.
 */
function useDropTarget(
  drag: PlanDrag,
  onDrop: (plan: ApiPlan, id: string) => void,
  accepts: (plan: ApiPlan, id: string) => boolean = () => true,
) {
  const [over, setOver] = useState<string | null>(null);
  const props = (id: string) => ({
    onDragOver(e: DragEvent) {
      const plan = drag.current();
      if (!plan || !accepts(plan, id)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (over !== id) setOver(id);
    },
    onDragLeave(e: DragEvent) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(v => (v === id ? null : v));
    },
    onDrop(e: DragEvent) {
      const plan = drag.current();
      setOver(null);
      if (!plan || !accepts(plan, id)) return;
      e.preventDefault();
      onDrop(plan, id);
    },
  });
  return { over: drag.dragging ? over : null, props };
}

/**
 * Month grid; each day lists its plans and offers a quick "plan on this day" button. Confirmed brand deals that
 * no plan covers yet show on their date as a dashed marker that starts a plan for them.
 * Cards are dragged to another day; while dragging, each column lights up by how many views the channel usually
 * gets on that weekday (`audience`, 0..1).
 */
export function PlannerCalendar({
  days,
  month,
  plans,
  channels,
  onOpen,
  onCreate,
  drag,
  audience,
  onMoveDate,
  deals,
  onPlanDeal,
  records = [],
  onOpenRecord = () => {},
}: ViewProps & {
  days: string[];
  month: string;
  onCreate: (day: string) => void;
  drag: PlanDrag;
  audience: number[] | null;
  onMoveDate: (plan: ApiPlan, day: string) => void;
  /** Confirmed deals still without a plan. */
  deals: Financial[];
  onPlanDeal: (deal: Financial) => void;
  /** Published content / detected lives no plan claims. */
  records?: ApiPlanRecord[];
  onOpenRecord?: (record: ApiPlanRecord) => void;
}) {
  const today = dateToday();
  const target = useDropTarget(drag, onMoveDate);
  return (
    <>
      <div className="panel planner-calendar-wrap">
        <div
          className={'planner-calendar' + (drag.dragging ? ' is-dragging' : '') + (audience ? ' has-audience' : '')}
          role="region"
          aria-label="Calendário de conteúdos"
        >
          <div className="planner-weekdays" aria-hidden="true">
            {weekdays.map(day => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="planner-days">
            {days.map(day => (
              <div
                role="group"
                className={
                  'planner-day' +
                  (day.slice(0, 7) !== month.slice(0, 7) ? ' outside' : '') +
                  (day === today ? ' is-today' : '') +
                  (target.over === day ? ' is-drop-target' : '')
                }
                key={day}
                aria-label={date(day).toLocaleDateString('pt-BR')}
                style={audience ? ({ '--audience': audience[weekdayIndex(day)] } as CSSProperties) : undefined}
                {...target.props(day)}
              >
                <header>
                  <time dateTime={day}>{Number(day.slice(-2))}</time>
                  {day === today && <span>HOJE</span>}
                  <button
                    className="planner-add-day"
                    aria-label={'Planejar em ' + day}
                    disabled={!channels.length}
                    onClick={() => onCreate(day)}
                  >
                    <Plus size={13} />
                  </button>
                </header>
                {plans
                  .filter(p => p.date === day)
                  .map(plan => (
                    <PlanChip key={plan.id} plan={plan} channels={channels} onOpen={() => onOpen(plan)} drag={drag} />
                  ))}
                {records
                  .filter(r => r.date === day)
                  .map(record => (
                    <RecordChip key={record.id} record={record} onOpen={() => onOpenRecord(record)} />
                  ))}
                {deals
                  .filter(d => d.date === day)
                  .map(deal => (
                    <button
                      key={deal.id}
                      className="planner-deal-marker"
                      aria-label={'Planejar a publi ' + deal.title}
                      onClick={() => onPlanDeal(deal)}
                    >
                      <span>
                        <BadgeDollarSign size={11} aria-hidden="true" />
                        Publi confirmada
                      </span>
                      <strong>{deal.title}</strong>
                      <small>
                        {money(deal.amountCents / 100, deal.currency)}
                        {deal.endDate && deal.endDate !== deal.date
                          ? ` · até ${deal.endDate.slice(8, 10)}/${deal.endDate.slice(5, 7)}`
                          : ''}{' '}
                        · <Plus size={10} aria-hidden="true" /> Planejar
                      </small>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="planner-hint">
        <Move size={13} aria-hidden="true" />
        Arraste um card para outro dia
        {audience
          ? ' — quanto mais clara a coluna, mais views seu canal costuma ter nesse dia da semana (últimos 90 dias).'
          : '.'}
      </p>
    </>
  );
}

/**
 * One column per stage; cards are dragged between columns (or advanced in the detail panel). While dragging, the
 * columns the card's format does not have (a live has no recording or editing) are dimmed and refuse the drop.
 */
export function PlannerPipeline({
  plans,
  channels,
  onOpen,
  drag,
  onMoveStage,
}: ViewProps & { drag: PlanDrag; onMoveStage: (plan: ApiPlan, stage: ApiPlanStage) => void }) {
  const fits = (plan: ApiPlan, stage: string) => stageFits(stage as ApiPlanStage, plan.format);
  const target = useDropTarget(drag, (plan, stage) => onMoveStage(plan, stage as ApiPlanStage), fits);
  return (
    <div className={'planner-pipeline' + (drag.dragging ? ' is-dragging' : '')}>
      {allStages.map(stage => {
        const column = plans.filter(p => p.stage === stage);
        return (
          <section
            className={
              'panel' +
              (target.over === stage ? ' is-drop-target' : '') +
              (drag.dragging && !fits(drag.dragging, stage) ? ' is-unavailable' : '')
            }
            key={stage}
            aria-label={stage}
            {...target.props(stage)}
          >
            <header>
              <h3>{stage}</h3>
              <span>{column.length}</span>
            </header>
            {column.map(plan => (
              <PlanChip key={plan.id} plan={plan} channels={channels} onOpen={() => onOpen(plan)} drag={drag} />
            ))}
            {!column.length && <p className="planner-column-empty">Nenhum conteúdo nesta etapa</p>}
          </section>
        );
      })}
    </div>
  );
}

/** Plain table of the month's plans. */
export function PlannerList({ plans, channels, onOpen }: ViewProps) {
  return (
    <section className="panel table-wrap">
      <table className="planner-list">
        <thead>
          <tr>
            <th>Conteúdo</th>
            <th>Canal</th>
            <th>Data</th>
            <th>Etapa</th>
          </tr>
        </thead>
        <tbody>
          {plans.map(p => (
            <tr key={p.id}>
              <td>
                <button onClick={() => onOpen(p)}>{p.title}</button>
              </td>
              <td>{channelName(channels, p)}</td>
              <td>
                {date(p.date).toLocaleDateString('pt-BR')}
                {p.time ? ' · ' + p.time : ''}
              </td>
              <td>{p.stage}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!plans.length && <div className="empty">Nenhum conteúdo planejado neste mês.</div>}
    </section>
  );
}
