import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Link2Off,
  Pencil,
  Radio,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { ApiChannel, ApiPlan, ApiPlanInput } from '../api';
import { confirmAction } from '../ConfirmDialog';
import { dateToday, money, num, type Financial, type Video } from '../studioApi';
import { PlatformDeck } from '../PlatformDeck';
import { PlanCover } from './PlanCover';
import {
  flowOf,
  isMultistream,
  nextStage,
  planChannelIds,
  planPlatforms,
  previousStage,
  PUBLISHED,
  relativeDay,
  scheduleLabel,
  stageLabel,
  stageProgress,
  timeConflicts,
} from './calendar';

type Props = {
  plan: ApiPlan | null;
  channels: ApiChannel[];
  deals: Financial[];
  saving: boolean;
  error: string;
  /** Saves a partial change; resolves false when the API refused it (the error is shown). */
  onPatch: (plan: ApiPlan, body: Partial<ApiPlanInput>) => Promise<boolean>;
  onEdit: (plan: ApiPlan) => void;
  onRemove: (plan: ApiPlan) => void;
  onClose: () => void;
  /** Latest videos of the plan's channels, to link the published one by hand. */
  loadVideos: (channelIds: string[]) => Promise<Video[]>;
  /** Every plan of the calendar, to point out time conflicts. */
  plans?: ApiPlan[];
};

/**
 * Side panel of a plan: stage stepper with back/advance (and "Publicar" once ready), schedule, brand deal, the
 * published video, move to another day, notes and removal. `plan === null` closes it.
 */
export function PlanDrawer({
  plan,
  channels,
  deals,
  saving,
  error,
  onPatch,
  onEdit,
  onRemove,
  onClose,
  loadVideos,
  plans = [],
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [notes, setNotes] = useState(''),
    [time, setTime] = useState(''),
    [videos, setVideos] = useState<Video[] | null>(null),
    [videosError, setVideosError] = useState('');
  const planId = plan?.id;
  useEffect(() => {
    if (plan && !dialog.current?.open) dialog.current?.showModal();
    if (!plan && dialog.current?.open) dialog.current?.close();
  }, [plan]);
  // Local copies of the free-text fields, reset when another plan is opened (or saved from elsewhere).
  useEffect(() => {
    setNotes(plan?.notes ?? '');
    setTime(plan?.time ?? '');
    setVideos(null);
    setVideosError('');
  }, [planId, plan?.notes, plan?.time]);

  // Closed programmatically (e.g. while the edit form is open): no onClose, so the selection survives.
  if (!plan) return <dialog ref={dialog} className="planner-drawer" aria-label="Detalhes do conteúdo" />;

  const today = dateToday(),
    published = plan.stage === PUBLISHED,
    live = plan.format === 'Live',
    flow = flowOf(plan.format),
    next = nextStage(plan.stage, plan.format),
    previous = previousStage(plan.stage, plan.format),
    progress = stageProgress(plan.stage, plan.format),
    // A ready live is scheduled until its day comes: only then can it be marked as done.
    scheduled = live && !published && !next && plan.date > today,
    channel = channels.find(c => c.id === plan.channelId),
    where = planChannelIds(plan)
      .map(id => channels.find(c => c.id === id)?.name)
      .filter(Boolean)
      .join(' + '),
    clashes = timeConflicts({ id: plan.id, date: plan.date, time: time || null }, plans),
    channelDeals = deals.filter(d => d.channelId === plan.channelId || d.id === plan.dealId);

  async function publish() {
    if (!plan) return;
    const confirmed = await confirmAction(
      live
        ? {
            title: 'Marcar a live como realizada?',
            message:
              'A live passa para “Realizada”. Quando o VOD aparecer na sincronização do canal com o mesmo título, ele é vinculado aqui.',
            confirmLabel: 'Marcar como realizada',
          }
        : {
            title: 'Marcar como publicado?',
            message:
              'O envio direto para o YouTube chega numa próxima versão. Por enquanto, o plano passa para “Publicado” e é ligado ao vídeo assim que ele aparecer na sincronização do canal com o mesmo título.',
            confirmLabel: 'Marcar como publicado',
          },
    );
    if (confirmed) await onPatch(plan, { stage: PUBLISHED });
  }
  async function chooseVideo() {
    if (!plan) return;
    setVideosError('');
    try {
      setVideos(await loadVideos(planChannelIds(plan)));
    } catch (e) {
      setVideosError((e as Error).message);
    }
  }
  const saveTime = () => {
    if ((plan.time ?? '') !== time) void onPatch(plan, { time: time || null });
  };
  const saveNotes = () => {
    if ((plan.notes ?? '') !== notes.trim()) void onPatch(plan, { notes });
  };
  /** Closing saves what is still being typed (time, notes). */
  const close = () => {
    saveTime();
    saveNotes();
    onClose();
  };

  return (
    <dialog ref={dialog} className="planner-drawer" aria-labelledby="plan-drawer-title" onClose={close}>
      <header>
        <div>
          <h2 id="plan-drawer-title">{plan.title}</h2>
          <p>
            {[
              plan.format,
              stageLabel(plan.stage, plan.format),
              isMultistream(plan) ? 'MultiStream' : (channel?.name ?? plan.platform),
            ].join(' · ')}
          </p>
        </div>
        <button type="button" className="icon" aria-label="Editar conteúdo" onClick={() => onEdit(plan)}>
          <Pencil size={16} />
        </button>
        <button type="button" className="icon" aria-label="Fechar detalhes" onClick={close}>
          <X size={19} />
        </button>
      </header>
      <div className="planner-drawer-body">
        <PlanCover plan={plan} caption={false} />

        <ol className={'planner-stepper' + (published ? ' is-published' : '')} aria-label="Etapas de produção">
          {flow.map((stage, i) => {
            const done = i < progress - 1 || published,
              current = !published && i === progress - 1;
            return (
              <li
                key={stage}
                className={(done ? 'done' : '') + (current ? ' current' : '')}
                aria-current={current ? 'step' : undefined}
              >
                <span aria-hidden="true">{done && <Check size={12} strokeWidth={3} />}</span>
                {stageLabel(stage, plan.format)}
              </li>
            );
          })}
        </ol>

        <div className="planner-stage-actions">
          <button
            type="button"
            disabled={!previous || saving}
            onClick={() => previous && void onPatch(plan, { stage: previous })}
          >
            <ChevronLeft size={15} />
            Voltar etapa
          </button>
          {next ? (
            <button
              type="button"
              className="primary"
              disabled={saving}
              onClick={() => void onPatch(plan, { stage: next })}
            >
              Avançar para {stageLabel(next, plan.format)}
              <ChevronRight size={15} />
            </button>
          ) : scheduled ? (
            <span className="planner-published-badge is-scheduled">
              <CalendarClock size={14} />
              Agendada · {relativeDay(plan.date, today)}
            </span>
          ) : published ? (
            <span className="planner-published-badge">
              <Check size={14} strokeWidth={3} />
              {stageLabel(PUBLISHED, plan.format)}
            </span>
          ) : (
            <button type="button" className="primary planner-publish" disabled={saving} onClick={() => void publish()}>
              {live ? <Radio size={15} /> : <Upload size={15} />}
              {live ? 'Marcar como realizada' : 'Publicar'}
            </button>
          )}
        </div>

        <dl className="planner-facts">
          <div>
            <dt>{live ? 'Live' : 'Publicação'}</dt>
            <dd>{scheduleLabel(plan.date, plan.time, today)}</dd>
          </div>
          <div>
            <dt>Formato</dt>
            <dd>{plan.format}</dd>
          </div>
          <div>
            <dt>Onde</dt>
            <dd className="planner-where">
              <PlatformDeck platforms={planPlatforms(plan)} size={16} />
              <span>{where || plan.platform}</span>
              {isMultistream(plan) && <span className="planner-multistream">MultiStream</span>}
            </dd>
          </div>
          <div>
            <dt>
              <label htmlFor="plan-deal">Publi</label>
            </dt>
            <dd>
              <select
                id="plan-deal"
                value={plan.dealId ?? ''}
                disabled={saving}
                onChange={e => void onPatch(plan, { dealId: e.target.value || null })}
              >
                <option value="">Nenhuma</option>
                {channelDeals.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.title} · {money(d.amountCents / 100, d.currency)}
                  </option>
                ))}
              </select>
            </dd>
          </div>
        </dl>

        {(plan.content || plan.stage === 'Pronto' || published) && (
          <section className="planner-drawer-section">
            <h3>{live ? 'VOD da live' : 'Vídeo publicado'}</h3>
            {plan.content ? (
              <div className="planner-linked-video">
                <div>
                  <strong>{plan.content.title}</strong>
                  <small>
                    {plan.content.views !== null && num(plan.content.views) + ' views'}
                    {plan.content.game && ' · ' + plan.content.game}
                    {plan.content.linked === 'auto' && ' · vinculado automaticamente'}
                    {plan.content.linked === 'deal' && ' · vinculado pela publi'}
                  </small>
                </div>
                {plan.content.watchUrl && (
                  <a
                    href={plan.content.watchUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Abrir vídeo na plataforma"
                  >
                    <ExternalLink size={15} />
                  </a>
                )}
                {plan.content.linked === 'manual' && (
                  <button
                    type="button"
                    className="icon"
                    aria-label="Desvincular vídeo"
                    disabled={saving}
                    onClick={() => void onPatch(plan, { contentId: null })}
                  >
                    <Link2Off size={15} />
                  </button>
                )}
              </div>
            ) : (
              <p className="planner-drawer-note">
                Quando um vídeo com o mesmo título aparecer na sincronização do canal, ele é vinculado aqui
                automaticamente.
              </p>
            )}
            {videos === null ? (
              <button type="button" className="planner-link-button" onClick={() => void chooseVideo()}>
                {plan.content ? 'Escolher outro vídeo' : 'Escolher o vídeo'}
              </button>
            ) : (
              <label className="planner-field">
                Vídeo do canal
                <select
                  value=""
                  disabled={saving}
                  onChange={e => e.target.value && void onPatch(plan, { contentId: e.target.value })}
                >
                  <option value="">{videos.length ? 'Selecione…' : 'Nenhum vídeo sincronizado'}</option>
                  {videos.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {videosError && <p className="api-error">{videosError}</p>}
          </section>
        )}

        <section className="planner-drawer-section">
          <h3>Mover para outro dia</h3>
          <div className="planner-form-row">
            <label className="planner-field">
              Dia
              <input
                type="date"
                required
                value={plan.date}
                disabled={saving}
                onChange={e => e.target.value && void onPatch(plan, { date: e.target.value })}
              />
            </label>
            <label className="planner-field">
              Horário
              <input type="time" value={time} onChange={e => setTime(e.target.value)} onBlur={saveTime} />
            </label>
          </div>
          {clashes.length > 0 && (
            <p className="planner-conflict" role="status">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>
                Horário próximo de {clashes.map(p => `“${p.title}” (${p.format} · ${p.time})`).join(', ')} no mesmo dia.
              </span>
            </p>
          )}
        </section>

        <section className="planner-drawer-section">
          <h3>
            <label htmlFor="plan-notes">Notas</label>
          </h3>
          <textarea
            id="plan-notes"
            rows={4}
            maxLength={2000}
            placeholder="Roteiro rápido, lembretes de gravação…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={saveNotes}
          />
        </section>

        {error && (
          <p role="alert" className="api-error">
            {error}
          </p>
        )}
        <button type="button" className="planner-remove" disabled={saving} onClick={() => onRemove(plan)}>
          <Trash2 size={14} />
          Remover do planejamento
        </button>
      </div>
    </dialog>
  );
}
