import { useEffect, useState } from 'react';
import { Settings2, TrendingUp } from 'lucide-react';
import { money, num, studioRequest } from '../studioApi';

type Tiers = { tier1: number | null; tier2: number | null; tier3: number | null; prime: number | null };
export type RevenueItem = {
  channelId: string;
  name: string;
  month: string;
  subs: { tier1: number; tier2: number; tier3: number; gifted: number; total: number | null; complete: boolean } | null;
  bits: number | null;
  values: Tiers | null;
  /** Prime subs among the active Tier 1, from the share of Prime in the chat sub announcements of 30 days. */
  prime: { estimated: number; share: number | null; samples: number };
  estimate: { subs: number | null; bits: number | null; total: number | null; currency: string };
  monthEvents: { subs: number; resubs: number; gifts: number; bits: number };
  missing: string[];
  observedAt: string | null;
};
const TIER_LABELS: [keyof Tiers, string][] = [
  ['tier1', 'Tier 1'],
  ['tier2', 'Tier 2'],
  ['tier3', 'Tier 3'],
  ['prime', 'Prime Gaming'],
];
const monthName = (month: string) =>
  new Date(month + '-15T12:00:00Z').toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });

/** Net value per tier: the form fields, in US$, empty meaning "not set". */
function ValuesForm({
  item,
  onSave,
  onCancel,
}: {
  item: RevenueItem;
  onSave: (values: Tiers) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="revenue-values"
      onSubmit={e => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const read = (k: string) => {
          const raw = String(data.get(k) ?? '')
            .trim()
            .replace(',', '.');
          return raw === '' ? null : Number(raw);
        };
        onSave({ tier1: read('tier1'), tier2: read('tier2'), tier3: read('tier3'), prime: read('prime') });
      }}
    >
      <p className="muted">
        Quanto você recebe, em US$, por inscrição ativa de cada tier (já descontada a parte da Twitch). O Prime Gaming
        não segue a divisão: é um valor fixo pelo país de quem se inscreveu (Brasil: US$ 0,75, usado se ficar vazio).
        Dica: em Analytics › Receita, divida a receita de cada tipo de um mês pelo número de inscrições dele.
      </p>
      <div>
        {TIER_LABELS.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              name={key}
              inputMode="decimal"
              placeholder={key === 'prime' ? '0,75 (Brasil)' : 'US$'}
              defaultValue={item.values?.[key] ?? ''}
              pattern="[0-9]+([.,][0-9]{1,2})?"
            />
          </label>
        ))}
      </div>
      <div className="revenue-values-actions">
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
        <button className="primary">Salvar valores</button>
      </div>
    </form>
  );
}

/**
 * This month's Twitch revenue estimate: active subscribers × the net value per tier the creator sets, plus bits
 * (US$ 0.01 each). Ads and Prime payouts are not included: their value never reaches the API.
 */
export function TwitchRevenue({ channelIds, revision }: { channelIds: string[]; revision: number }) {
  const [items, setItems] = useState<RevenueItem[] | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0);
  const scope = channelIds.join(',');
  useEffect(() => {
    let active = true;
    studioRequest<{ items: RevenueItem[] }>('streams/revenue', { params: { channelId: scope.split(',') } })
      .then(r => active && setItems(r.items))
      .catch(e => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [scope, revision, reload]);
  async function save(item: RevenueItem, values: Tiers) {
    setError('');
    try {
      await studioRequest(`channels/${item.channelId}/revenue-settings`, { method: 'PATCH', body: values });
      setEditing(null);
      setReload(v => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar.');
    }
  }
  return (
    <section className="panel twitch-revenue">
      <div className="section-head">
        <h2>
          <TrendingUp size={16} aria-hidden="true" /> Receita estimada
        </h2>
        {items?.[0] && <span className="glass-tag">{monthName(items[0].month)}</span>}
      </div>
      {error && (
        <p className="api-error" role="alert">
          {error}
        </p>
      )}
      {!items
        ? !error && <p className="muted">Carregando…</p>
        : items.map(item => (
            <div className="revenue-channel" key={item.channelId}>
              {items.length > 1 && <h3>{item.name}</h3>}
              <strong className="revenue-total">
                {item.estimate.total === null ? '—' : money(item.estimate.total)}
                <small>estimativa do mês até agora</small>
              </strong>
              <dl className="revenue-lines">
                <div>
                  <dt>
                    Inscrições
                    <small>
                      {item.subs
                        ? `${num(item.subs.tier1)} T1 · ${num(item.subs.tier2)} T2 · ${num(item.subs.tier3)} T3` +
                          (item.subs.gifted ? ` · ${num(item.subs.gifted)} presenteadas` : '')
                        : 'aguardando a próxima coleta'}
                    </small>
                    <small>
                      {item.prime.share === null
                        ? 'Prime: aguardando anúncios de inscrição no chat'
                        : `~${num(item.prime.estimated)} dos T1 são Prime (${Math.round(item.prime.share * 100)}% de ${num(item.prime.samples)} anúncios)`}
                    </small>
                  </dt>
                  <dd>
                    {item.estimate.subs !== null ? (
                      money(item.estimate.subs)
                    ) : (
                      <button type="button" className="link-button" onClick={() => setEditing(item.channelId)}>
                        Definir valores
                      </button>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>
                    Bits
                    <small>
                      {item.missing.includes('bits')
                        ? 'reconecte a Twitch para incluir'
                        : item.bits === null
                          ? 'aguardando a próxima coleta'
                          : `${num(item.bits)} bits no mês`}
                    </small>
                  </dt>
                  <dd>{money(item.estimate.bits)}</dd>
                </div>
                <div className="is-muted">
                  <dt>
                    Anúncios
                    <small>valor não disponível na API</small>
                  </dt>
                  <dd>—</dd>
                </div>
              </dl>
              {editing === item.channelId ? (
                <ValuesForm item={item} onSave={values => void save(item, values)} onCancel={() => setEditing(null)} />
              ) : (
                <button type="button" className="revenue-edit" onClick={() => setEditing(item.channelId)}>
                  <Settings2 size={13} />
                  Valor por inscrição
                </button>
              )}
              {item.missing.length > 0 && (
                <p className="footnote">
                  Para registrar {item.missing.map(m => (m === 'bits' ? 'bits' : 'o chat')).join(' e ')}, reconecte a
                  Twitch em <a href="#/settings">Configurações</a> e autorize as novas permissões.
                </p>
              )}
            </div>
          ))}
      <p className="footnote">
        Estimativa: inscrições ativas × valor por tier + bits (US$ 0,01 cada). A API mostra o Prime como Tier 1; a parte
        Prime é estimada pelos anúncios de inscrição no chat dos últimos 30 dias, e quem assina pode ocultar o anúncio,
        então ela tende a ficar abaixo do real. Não inclui anúncios.
      </p>
    </section>
  );
}
