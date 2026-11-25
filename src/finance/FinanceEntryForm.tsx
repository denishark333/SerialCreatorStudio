import { useState } from 'react';
import { AmountInput } from '../AmountInput';
import type { ApiChannel } from '../api';
import { dateToday } from '../studioApi';

export type FinancialType = 'payout' | 'deal';
export type FinancialInput = {
  type: FinancialType;
  title: string;
  channelId: string;
  amount: number;
  currency: string;
  date: string;
  stage: string;
  endDate?: string | null;
  keywords?: string[];
};
export const dealStages = ['Proposta', 'Negociação', 'Confirmado', 'Recebido'];
export const payoutStages = ['Previsto', 'Recebido'];

/** Comma-separated keywords → list (trimmed, no empties, no repeats). */
export const parseKeywords = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map(k => k.trim())
      .filter(Boolean),
  ),
];

/**
 * Manual payout/deal record. `onSave` sends it; `onInvalid` reports a validation message.
 * A deal also has its delivery window (start → end) and the keywords that recognise the content delivering it.
 */
export function FinanceEntryForm({
  type,
  channels,
  channelId,
  busy,
  onSave,
  onInvalid,
}: {
  type: FinancialType;
  channels: ApiChannel[];
  channelId: string;
  busy: boolean;
  onSave: (entry: FinancialInput) => void;
  onInvalid: (message: string) => void;
}) {
  const [currency, setCurrency] = useState('BRL');
  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const exact = String(data.get('amountValue') ?? '');
    const amount = exact === '' ? null : Number(exact);
    if (amount === null || !Number.isFinite(amount)) {
      onInvalid('Informe o valor do registro.');
      (form.elements.namedItem('amount') as HTMLInputElement | null)?.focus();
      return;
    }
    onSave({
      type,
      title: String(data.get('title')),
      channelId: String(data.get('channelId')),
      amount,
      currency: String(data.get('currency')),
      date: String(data.get('date')),
      stage: String(data.get('stage')),
      ...(type === 'deal'
        ? {
            endDate: String(data.get('endDate') ?? '') || null,
            keywords: parseKeywords(String(data.get('keywords') ?? '')),
          }
        : {}),
    });
  }
  return (
    <section className="panel settings-panel">
      <form
        className="live-plan-form"
        onSubmit={e => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
      >
        <label>
          {type === 'payout' ? 'Descrição' : 'Marca / parceria'}
          <input name="title" required maxLength={120} />
        </label>
        <label>
          Canal
          <select name="channelId" defaultValue={channelId || channels[0]?.id}>
            {channels.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Valor
          {/* Mask follows the selected currency (BRL/EUR 1.000,00 · USD 1,000.00). */}
          <AmountInput name="amount" valueName="amountValue" currency={currency} required />
        </label>
        <label>
          Moeda
          <select name="currency" value={currency} onChange={e => setCurrency(e.target.value)}>
            <option>BRL</option>
            <option>USD</option>
            <option>EUR</option>
          </select>
        </label>
        <label>
          {type === 'deal' ? 'Início da entrega' : 'Data'}
          <input name="date" type="date" defaultValue={dateToday()} required />
        </label>
        {type === 'deal' && (
          <>
            <label>
              Fim da entrega <small>(vazio: 1 dia)</small>
              <input name="endDate" type="date" />
            </label>
            <label className="finance-keywords">
              Palavras-chave <small>(separadas por vírgula: marca, #publi, jogo…)</small>
              <input name="keywords" maxLength={600} placeholder="Ex.: marca x, #publi, aion 2" />
            </label>
          </>
        )}
        <label>
          Etapa
          <select name="stage">
            {(type === 'payout' ? payoutStages : dealStages).map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={busy || !channels.length}>
          Salvar registro
        </button>
      </form>
    </section>
  );
}
