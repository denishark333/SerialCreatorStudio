import { useEffect, useRef } from 'react';
import { BadgeDollarSign, Check, ExternalLink, Plus, X } from 'lucide-react';
import type { ApiChannel, ApiPlan, ApiPlanInput, ApiPlanRecord } from '../api';
import { PlatformIcon } from '../PlatformIcon';
import { dateToday, num } from '../studioApi';
import { flowOf, scheduleLabel, stageLabel } from './calendar';
import { PlanCover } from './PlanCover';
import { recordDone } from './PlannerViews';

/** The plan format a published content stands for: a VOD is a live that happened. */
export const recordFormat = (record: ApiPlanRecord): ApiPlanInput['format'] =>
  record.format === 'VOD' || record.format === 'Live'
    ? 'Live'
    : record.format === 'Short'
      ? 'Short'
      : record.format === 'Clip'
        ? 'Clip'
        : 'Vídeo';

/** Body of the plan created from a record: published, on its day and time, linked to the content. */
export const planFromRecord = (record: ApiPlanRecord): ApiPlanInput => ({
  title: record.title.slice(0, 120),
  channelId: record.channelId,
  format: recordFormat(record),
  date: record.date,
  stage: 'Publicado',
  ...(record.time ? { time: record.time } : {}),
  ...(record.kind === 'content' ? { contentId: record.id } : {}),
});

/**
 * Side panel of a record (published content or a live seen by the sync, filled in automatically): same look as a
 * plan's panel, with the content's details, a link to the platform and "Adicionar ao planejamento", which turns
 * it into a plan (linked to the content) to add notes, a brand deal, etc. `record === null` closes it.
 */
export function RecordDrawer({
  record,
  channels,
  saving,
  error,
  onAdd,
  onClose,
}: {
  record: ApiPlanRecord | null;
  channels: ApiChannel[];
  saving: boolean;
  error: string;
  onAdd: (record: ApiPlanRecord) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (record && !dialog.current?.open) dialog.current?.showModal();
    if (!record && dialog.current?.open) dialog.current?.close();
  }, [record]);
  if (!record) return <dialog ref={dialog} className="planner-drawer" aria-label="Conteúdo publicado" />;
  const format = recordFormat(record),
    done = recordDone(record),
    channel = channels.find(c => c.id === record.channelId);
  // The cover and stepper of a plan, as if it had gone through every stage.
  const asPlan = {
    id: record.id,
    title: record.title,
    channelId: record.channelId,
    platform: record.platform,
    platforms: [record.platform],
    format,
    date: record.date,
    time: record.time,
    stage: 'Publicado',
    content: record.thumbnailUrl
      ? {
          id: record.id,
          title: record.title,
          date: record.date,
          thumbnailUrl: record.thumbnailUrl,
          watchUrl: null,
          views: null,
          linked: 'auto',
        }
      : null,
  } as ApiPlan;
  return (
    <dialog ref={dialog} className="planner-drawer" aria-labelledby="record-drawer-title" onClose={onClose}>
      <header>
        <div>
          <h2 id="record-drawer-title">{record.title}</h2>
          <p>{[record.format, done, channel?.name ?? record.platform].join(' · ')}</p>
        </div>
        <button type="button" className="icon" aria-label="Fechar detalhes" onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      <div className="planner-drawer-body">
        <PlanCover plan={asPlan} caption={false} />
        <ol className="planner-stepper is-published" aria-label="Etapas de produção">
          {flowOf(format).map(stage => (
            <li key={stage} className="done">
              <span aria-hidden="true">
                <Check size={12} strokeWidth={3} />
              </span>
              {stageLabel(stage, format)}
            </li>
          ))}
        </ol>
        <div className="planner-stage-actions">
          {record.watchUrl && (
            <a className="button-link" href={record.watchUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} />
              Abrir na {record.platform}
            </a>
          )}
          <button type="button" className="primary" disabled={saving} onClick={() => onAdd(record)}>
            <Plus size={15} />
            Adicionar ao planejamento
          </button>
        </div>
        <dl className="planner-facts">
          <div>
            <dt>{format === 'Live' ? 'Live' : 'Publicação'}</dt>
            <dd>{scheduleLabel(record.date, record.time, dateToday())}</dd>
          </div>
          <div>
            <dt>Formato</dt>
            <dd>{record.format}</dd>
          </div>
          <div>
            <dt>Onde</dt>
            <dd className="planner-where">
              <PlatformIcon platform={record.platform} size={16} />
              <span>{channel?.name ?? record.platform}</span>
            </dd>
          </div>
          {record.game && (
            <div>
              <dt>Jogo</dt>
              <dd>{record.game}</dd>
            </div>
          )}
          {record.views !== null && (
            <div>
              <dt>Views</dt>
              <dd>{num(record.views)}</dd>
            </div>
          )}
          {record.deal && (
            <div>
              <dt>Publi</dt>
              <dd className="planner-where">
                <span className="planner-chip-deal">
                  <BadgeDollarSign size={11} aria-hidden="true" />
                  Entregue · {record.deal.title}
                </span>
              </dd>
            </div>
          )}
        </dl>
        <p className="planner-drawer-note">
          {record.kind === 'live'
            ? 'Live detectada pela sincronização (a plataforma não guarda o VOD).'
            : 'Preenchido automaticamente a partir do que foi publicado.'}{' '}
          Adicione ao planejamento para anotar, vincular uma publi ou ajustar os detalhes.
        </p>
        {error && (
          <p role="alert" className="api-error">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
