import { useEffect, useRef, type FormEvent } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import type { ApiChannel, ApiPlan, ApiPlanInput } from '../api';
import { PlatformIcon } from '../PlatformIcon';
import { flowOf, formats, planChannelIds, PUBLISHED, stageForFormat, stageLabel, timeConflicts } from './calendar';

export type PlanDraft = ApiPlanInput & { id?: string };

/**
 * Modal editor for a new or existing plan. `draft === null` closes it.
 * A live picks every channel it goes to (more than one = multistream); other formats pick one channel.
 * Plans within an hour of this one on the same day (any platform) are pointed out.
 */
export function PlanDialog({
  draft,
  channels,
  saving,
  error,
  onChange,
  onClose,
  onSave,
  onRemove,
  dealTitle,
  plans = [],
}: {
  draft: PlanDraft | null;
  channels: ApiChannel[];
  saving: boolean;
  error: string;
  onChange: (draft: PlanDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onRemove: () => void;
  /** Title of the brand deal a new plan was started from. */
  dealTitle?: string;
  /** Every plan of the calendar, to point out time conflicts. */
  plans?: ApiPlan[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (draft && !dialog.current?.open) dialog.current?.showModal();
    if (!draft && dialog.current?.open) dialog.current?.close();
  }, [draft]);
  const selected = draft ? planChannelIds(draft) : [];
  const clashes = draft ? timeConflicts(draft, plans) : [];
  /** Checks/unchecks a channel of a live; the first one left is the primary. */
  function toggle(id: string) {
    if (!draft) return;
    const next = selected.includes(id) ? selected.filter(v => v !== id) : [...selected, id];
    if (next.length) onChange({ ...draft, channelId: next[0], channelIds: next });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    onSave();
  }
  return (
    <dialog ref={dialog} className="planner-dialog" onCancel={onClose} onClose={onClose}>
      {draft && (
        <form onSubmit={submit}>
          <header>
            <div>
              <span className="eyebrow">PLANEJAMENTO</span>
              <h2>{draft.id ? 'Editar conteúdo' : 'Seu próximo conteúdo'}</h2>
              {dealTitle && <p className="planner-dialog-deal">Para a publi confirmada: {dealTitle}</p>}
            </div>
            <button type="button" className="icon" aria-label="Fechar planejamento" disabled={saving} onClick={onClose}>
              <X size={19} />
            </button>
          </header>
          <label>
            Título
            <input
              autoFocus
              required
              maxLength={120}
              value={draft.title}
              onChange={e => onChange({ ...draft, title: e.target.value })}
            />
          </label>
          <div className="planner-form-row">
            <label>
              Formato
              <select
                value={draft.format}
                onChange={e => {
                  // A live has no recording/editing: the stage follows the new format's flow.
                  // Only a live goes to several channels: another format keeps the primary one.
                  const format = e.target.value as ApiPlanInput['format'];
                  onChange({
                    ...draft,
                    format,
                    stage: stageForFormat(draft.stage ?? 'Ideia', format),
                    channelIds: format === 'Live' ? planChannelIds(draft) : undefined,
                  });
                }}
              >
                {formats.map(v => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Data
              <input
                type="date"
                required
                value={draft.date}
                onChange={e => onChange({ ...draft, date: e.target.value })}
              />
            </label>
          </div>
          {draft.format === 'Live' ? (
            <fieldset className="planner-platforms">
              <legend>
                Onde será a live
                {selected.length > 1 && <span className="planner-multistream">MultiStream</span>}
              </legend>
              {channels.map(c => {
                const checked = selected.includes(c.id);
                return (
                  <label key={c.id} className={'planner-platform-option' + (checked ? ' checked' : '')}>
                    <input
                      type="checkbox"
                      checked={checked}
                      // At least one channel: the last one can't be unchecked.
                      disabled={checked && selected.length === 1}
                      onChange={() => toggle(c.id)}
                    />
                    <PlatformIcon platform={c.platform} size={16} />
                    <span>{c.name}</span>
                  </label>
                );
              })}
            </fieldset>
          ) : (
            <label>
              Canal
              <select
                value={draft.channelId}
                required
                onChange={e => onChange({ ...draft, channelId: e.target.value, channelIds: undefined })}
              >
                {channels.map(c => (
                  <option value={c.id} key={c.id}>
                    {c.name} · {c.platform}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="planner-form-row">
            <label>
              Etapa
              <select
                value={draft.stage}
                onChange={e => onChange({ ...draft, stage: e.target.value as ApiPlan['stage'] })}
              >
                {[...flowOf(draft.format), ...(draft.id ? [PUBLISHED] : [])].map(v => (
                  <option key={v} value={v}>
                    {stageLabel(v, draft.format)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Horário
              <input
                type="time"
                value={draft.time ?? ''}
                onChange={e => onChange({ ...draft, time: e.target.value || null })}
              />
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
          <label>
            Notas
            <textarea
              rows={3}
              maxLength={2000}
              value={draft.notes ?? ''}
              onChange={e => onChange({ ...draft, notes: e.target.value })}
            />
          </label>
          {error && (
            <p role="alert" className="api-error">
              {error}
            </p>
          )}
          <footer>
            {draft.id && (
              <button type="button" disabled={saving} onClick={onRemove}>
                <Trash2 size={14} />
                Remover
              </button>
            )}
            <button className="primary" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar plano'}
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}
