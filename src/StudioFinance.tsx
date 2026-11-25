import { confirmAction } from './ConfirmDialog';
import { useMemberships } from './Members';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { studioRequest, type Financial, type Page, type Video } from './studioApi';
import type { ApiChannel } from './api';
import type { Revenue } from './liveTypes';
import { FinanceEarnings } from './finance/FinanceEarnings';
import { FinanceEntryForm, type FinancialInput } from './finance/FinanceEntryForm';
import { DealBoard, PayoutHistory } from './finance/FinanceRecords';
import { DealSummary } from './finance/FinanceSummary';

const tabs = [
  ['earnings', 'Ganhos'],
  ['payouts', 'Pagamentos'],
  ['deals', 'Parcerias'],
] as const;
type Tab = (typeof tabs)[number][0];

/** Financeiro: estimated earnings (YouTube) plus manual payout and brand-deal records. */
export function StudioFinance({
  channels,
  channelId,
  from,
  to,
  revenue,
}: {
  channels: ApiChannel[];
  channelId: string;
  from: string;
  to: string;
  revenue: Revenue | null;
}) {
  const { value: memberships } = useMemberships(channels, channelId);
  const [tab, setTab] = useState<Tab>('earnings'),
    [entries, setEntries] = useState<Financial[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [uploads, setUploads] = useState<Video[]>([]);
  const channelIds = channelId ? [channelId] : channels.map(c => c.id);
  useEffect(() => {
    let active = true;
    setError('');
    setEntries([]);
    setUploads([]);
    if (!channels.length) return;
    if (tab === 'earnings') {
      studioRequest<Page<Video>>('catalog', {
        params: { from, to, channelId: channelIds, sort: 'revenue', limit: 100 },
        list: true,
      })
        .then(r => {
          if (active) setUploads(r.data.filter(v => v.estimatedRevenue !== null));
        })
        .catch(e => {
          if (active) setError(e.message);
        });
      return () => {
        active = false;
      };
    }
    (async () => {
      const rows: Financial[] = [];
      let page = 1,
        pages = 1;
      do {
        const r = await studioRequest<Page<Financial>>('financial/' + tab, {
          params: { history: 'all', channelId: channelIds, limit: 100, page },
          list: true,
        });
        if (!active) return;
        rows.push(...r.data);
        pages = r.pagination.totalPages;
        page++;
      } while (page <= pages);
      if (active) setEntries(rows);
    })().catch(e => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [tab, channelId, from, to, revision, channels.map(c => c.id).join(',')]);

  /** Deleting a record always asks for confirmation (same rule as removing a plan). */
  async function remove(entry: Financial) {
    const confirmed = await confirmAction({
      title: 'Remover este registro?',
      message: `“${entry.title}” será removido do Financeiro. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Remover',
      tone: 'danger',
    });
    if (!confirmed) return;
    void studioRequest(`financial/${entry.id}`, { method: 'DELETE' })
      .then(() => setRevision(v => v + 1))
      .catch(error => setError(error.message));
  }
  function changeStage(entry: Financial, stage: string) {
    void studioRequest(`financial/${entry.id}`, { method: 'PATCH', body: { stage } })
      .then(() => setRevision(v => v + 1))
      .catch(e => setError(e.message));
  }
  function changeDelivery(entry: Financial, body: { endDate: string | null; keywords: string[] }) {
    void studioRequest(`financial/${entry.id}`, { method: 'PATCH', body })
      .then(() => setRevision(v => v + 1))
      .catch(e => setError(e.message));
  }
  async function save(body: FinancialInput) {
    setError('');
    setBusy(true);
    try {
      await studioRequest('financial', { method: 'POST', body });
      setOpen(false);
      setRevision(v => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="tabs">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'selected' : ''}
            onClick={() => {
              setTab(key);
              setOpen(false);
              setEntries([]);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="api-error" role="alert">
          {error}
        </p>
      )}
      {tab === 'earnings' ? (
        <FinanceEarnings revenue={revenue} memberships={memberships} uploads={uploads} />
      ) : (
        <>
          <div className="studio-heading-actions">
            <div>
              <h2>{tab === 'payouts' ? 'Pagamentos registrados' : 'Parcerias com marcas'}</h2>
              <p className="footnote">
                Registros manuais salvos no backend · histórico e previsões por canal. Não são dados importados de
                AdSense.
              </p>
            </div>
            <button className="primary" onClick={() => setOpen(!open)}>
              <Plus size={15} />
              {tab === 'payouts' ? 'Registrar pagamento' : 'Nova parceria'}
            </button>
          </div>
          {open && (
            <FinanceEntryForm
              type={tab === 'payouts' ? 'payout' : 'deal'}
              channels={channels}
              channelId={channelId}
              busy={busy}
              onSave={entry => void save(entry)}
              onInvalid={setError}
            />
          )}
          {tab === 'deals' ? (
            <>
              <DealSummary entries={entries} members={memberships} />
              <DealBoard
                entries={entries}
                onStage={changeStage}
                onRemove={entry => void remove(entry)}
                onDelivery={changeDelivery}
              />
            </>
          ) : (
            <PayoutHistory entries={entries} onStage={changeStage} onRemove={entry => void remove(entry)} />
          )}
        </>
      )}
    </>
  );
}
