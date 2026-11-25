import { AnimatedNumber } from '../DataMotion';
import { Banknote, Clock, Crown } from 'lucide-react';
import { money, num, type Financial } from '../studioApi';
import type { Memberships } from '../Members';
export function amountTotals(entries: Financial[]) {
  const sums = new Map<string, number>();
  for (const entry of entries) sums.set(entry.currency, (sums.get(entry.currency) ?? 0) + entry.amountCents / 100);
  return [...sums].map(([currency, amount]) => money(amount, currency)).join(' · ') || '—';
}
export function MembershipRevenue({ value }: { value: Memberships | null }) {
  return (
    <section className="panel membership-revenue">
      <Crown size={20} />
      <div>
        <h2>Base de membros pagantes</h2>
        <strong>
          <AnimatedNumber value={value?.total} format={num} /> <small>membros na última coleta</small>
        </strong>
        <p>
          {value?.revenue.reason ?? 'Aguardando a lista autorizada de membros do canal.'} A contagem não é somada à
          receita em dinheiro.
        </p>
      </div>
      <a className="text-link" href="#/community">
        Ver membros
      </a>
    </section>
  );
}
export function DealSummary({ entries, members }: { entries: Financial[]; members: Memberships | null }) {
  return (
    <div className="deal-summary">
      <article className="panel">
        <span>Propostas e negociações</span>
        <strong>{amountTotals(entries.filter(v => ['Proposta', 'Negociação'].includes(v.stage)))}</strong>
      </article>
      <article className="panel">
        <span>Parcerias confirmadas</span>
        <strong>{amountTotals(entries.filter(v => v.stage === 'Confirmado'))}</strong>
      </article>
      <article className="panel">
        <span>Membros pagantes</span>
        <strong>
          <AnimatedNumber value={members?.total} format={num} />
        </strong>
        <small>Receita recorrente não informada pela plataforma</small>
      </article>
    </div>
  );
}
export function NextPayout({ entries }: { entries: Financial[] }) {
  const next = entries.filter(v => v.stage === 'Previsto').sort((a, b) => a.date.localeCompare(b.date))[0];
  return (
    <aside className="panel payout-next">
      <span className="status">
        <Clock size={13} /> {next ? 'Previsto' : 'Sem previsão registrada'}
      </span>
      <strong>
        {next ? <AnimatedNumber value={next.amountCents / 100} format={v => money(v, next.currency)} /> : '—'}
      </strong>
      <h2>{next?.title ?? 'Próximo pagamento'}</h2>
      {next && <p>Data informada: {new Date(next.date + 'T12:00:00Z').toLocaleDateString('pt-BR')}</p>}
      <div className="payout-source">
        <Banknote size={20} />
        <span>
          Registro manual<strong>Não confirma transferência bancária</strong>
        </span>
      </div>
      <div className="payout-timeline">
        <span className={next ? 'active' : ''}>Previsão registrada</span>
        <span>Recebimento a confirmar</span>
      </div>
      <p className="footnote">Atualize o status do registro quando o pagamento for recebido.</p>
    </aside>
  );
}
