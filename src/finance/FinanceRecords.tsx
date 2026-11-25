import { useState } from 'react';
import { Tags, Trash2 } from 'lucide-react';
import { AnimatedNumber } from '../DataMotion';
import { money, type Financial } from '../studioApi';
import { dealStages, parseKeywords, payoutStages } from './FinanceEntryForm';
import { NextPayout, amountTotals } from './FinanceSummary';

type RecordActions = {
  entries: Financial[];
  onStage: (entry: Financial, stage: string) => void;
  onRemove: (entry: Financial) => void;
};
const shortDate = (day: string) => day.slice(8, 10) + '/' + day.slice(5, 7);

/**
 * Delivery of a deal on its card: the window and keywords the planner uses to recognise the content that delivers
 * it, editable in place.
 */
function DealDelivery({
  entry,
  onDelivery,
}: {
  entry: Financial;
  onDelivery: (entry: Financial, body: { endDate: string | null; keywords: string[] }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const period =
    entry.endDate && entry.endDate !== entry.date
      ? `${shortDate(entry.date)} a ${shortDate(entry.endDate)}`
      : shortDate(entry.date) + ' (1 dia)';
  if (!editing)
    return (
      <div className="deal-delivery">
        <small>Entrega: {period}</small>
        {entry.keywords?.length ? (
          <span className="deal-keywords">
            {entry.keywords.map(k => (
              <i key={k}>{k}</i>
            ))}
          </span>
        ) : (
          <small className="muted">Sem palavras-chave: a entrega não é reconhecida sozinha.</small>
        )}
        <button type="button" onClick={() => setEditing(true)}>
          <Tags size={12} />
          Editar entrega
        </button>
      </div>
    );
  return (
    <form
      className="deal-delivery editing"
      onSubmit={e => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        onDelivery(entry, {
          endDate: String(data.get('endDate') ?? '') || null,
          keywords: parseKeywords(String(data.get('keywords') ?? '')),
        });
        setEditing(false);
      }}
    >
      <label>
        Fim da entrega
        <input name="endDate" type="date" min={entry.date} defaultValue={entry.endDate ?? ''} />
      </label>
      <label>
        Palavras-chave
        <input name="keywords" defaultValue={(entry.keywords ?? []).join(', ')} placeholder="marca x, #publi" />
      </label>
      <div>
        <button type="button" onClick={() => setEditing(false)}>
          Cancelar
        </button>
        <button className="primary">Salvar</button>
      </div>
    </form>
  );
}

/** Deal pipeline: one column per stage, totals per currency (never summed across currencies). */
export function DealBoard({
  entries,
  onStage,
  onRemove,
  onDelivery,
}: RecordActions & {
  onDelivery: (entry: Financial, body: { endDate: string | null; keywords: string[] }) => void;
}) {
  return (
    <div className="kanban">
      {dealStages.map(stage => {
        const column = entries.filter(e => e.stage === stage);
        return (
          <section className="panel kanban-column" key={stage}>
            <header className="deal-column-title">
              <h3>
                {stage} <small>{column.length}</small>
              </h3>
              <strong>{amountTotals(column)}</strong>
            </header>
            {column.map(e => (
              <article className="plan-card" key={e.id}>
                <div className="deal-brand">
                  <span>{e.title.slice(0, 2).toUpperCase()}</span>
                  <h3>{e.title}</h3>
                </div>
                <strong>
                  <AnimatedNumber value={e.amountCents / 100} format={v => money(v, e.currency)} />
                </strong>
                <DealDelivery entry={e} onDelivery={onDelivery} />
                <select
                  aria-label={'Etapa da parceria ' + e.title}
                  value={e.stage}
                  onChange={event => onStage(e, event.target.value)}
                >
                  {dealStages.map(s => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button onClick={() => onRemove(e)}>
                  <Trash2 size={12} />
                  Remover registro
                </button>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Next expected payout and the full payout history. */
export function PayoutHistory({ entries, onStage, onRemove }: RecordActions) {
  return (
    <div className="payout-layout">
      <NextPayout entries={entries} />
      <section className="panel table-wrap payout-history">
        <header>
          <h2>Histórico de pagamentos</h2>
          <p>
            {entries.length} registros · {amountTotals(entries.filter(e => e.stage === 'Recebido'))} recebidos
          </p>
        </header>
        <table>
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Data</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Fonte</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td>{e.title}</td>
                <td>{e.date}</td>
                <td>
                  <AnimatedNumber value={e.amountCents / 100} format={v => money(v, e.currency)} />
                </td>
                <td>
                  <select
                    value={e.stage}
                    aria-label={'Status do pagamento ' + e.title}
                    onChange={event => onStage(e, event.target.value)}
                  >
                    {payoutStages.map(s => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td>Manual</td>
                <td>
                  <button aria-label={'Remover ' + e.title} onClick={() => onRemove(e)}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && <div className="empty">Nenhum pagamento registrado.</div>}
      </section>
    </div>
  );
}
