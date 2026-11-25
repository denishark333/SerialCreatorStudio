import { dataFetch } from './dataCache';
import { usePlatform } from './PlatformContext';
import { PlatformOverview } from './PlatformOverview';
import type { Coverage, Report, Revenue } from './liveTypes';
import { apiSession } from './apiSession';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowRight, ExternalLink, Link2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { createSerialApi, type ApiChannel } from './api';
import { apiBase as base } from './apiConfig';

// Tabs are downloaded when first opened (the overview, the landing tab, stays in this chunk).
const StudioPlanner = lazy(() => import('./StudioPlanner').then(m => ({ default: m.StudioPlanner })));
const StudioAnalytics = lazy(() => import('./StudioAnalytics').then(m => ({ default: m.StudioAnalytics })));
const StreamAnalytics = lazy(() => import('./StreamAnalytics').then(m => ({ default: m.StreamAnalytics })));
const StudioCommunity = lazy(() => import('./StudioCommunity').then(m => ({ default: m.StudioCommunity })));
const StudioFinance = lazy(() => import('./StudioFinance').then(m => ({ default: m.StudioFinance })));
const TabLoading = () => (
  <p className="api-note" role="status">
    Carregando…
  </p>
);

const n = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v);
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const previous = (to: string, days: number) => {
  const d = new Date(to + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};
async function request<T>(
  resource: string,
  params: Record<string, string | string[]> = {},
  method = 'GET',
): Promise<T> {
  const url = new URL('/api/v1/workspaces/' + apiSession.workspaceId + '/' + resource, base);
  Object.entries(params).forEach(([k, v]) => (Array.isArray(v) ? v : [v]).forEach(x => url.searchParams.append(k, x)));
  let res;
  try {
    res = await dataFetch(url, {
      method,
      headers: apiSession.token ? { Authorization: 'Bearer ' + apiSession.token } : {},
    });
  } catch {
    throw new Error('Backend indisponível. Inicie npm.cmd run backend:dev.');
  }
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error?.message ?? 'Erro ao consultar o backend');
  return payload.data;
}
function WorkspaceSections({ route }: { route: string }) {
  const { platform } = usePlatform();
  const [channels, setChannels] = useState<ApiChannel[]>([]),
    [selected, setSelected] = useState(''),
    [to, setTo] = useState(today()),
    [from, setFrom] = useState(() => previous(today(), 29)),
    [report, setReport] = useState<Report | null>(null),
    [revenue, setRevenue] = useState<Revenue | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [revision, setRevision] = useState(0);
  const api = () => createSerialApi(base, () => apiSession.token);
  const dates = { from, to, ...(selected ? { channelId: [selected] } : {}) };
  useEffect(() => {
    const f = () => setRevision(v => v + 1);
    addEventListener('serial-data-updated', f);
    return () => removeEventListener('serial-data-updated', f);
  }, []);
  useEffect(() => {
    dispatchEvent(new CustomEvent('serial-sync-range', { detail: { from, to } }));
  }, [from, to]);
  useEffect(() => {
    setMessage('');
  }, [route, from, to, selected]);
  useEffect(() => {
    setReport(null);
    setRevenue(null);
  }, [route, from, to, selected]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const status = await request<{ items: unknown[] }>('connections');
        if (!status.items.length) {
          if (!cancelled) setChannels([]);
          return;
        }
        const c = await api().channels(apiSession.workspaceId, { limit: 100, platform });
        if (cancelled) return;
        setChannels(c.data);
        if (!c.data.length) {
          setReport(null);
          setRevenue(null);
          return;
        }
        const scopedDates = { from, to, platform, channelId: c.data.map(c => c.id) };
        // Twitch/Kick analytics come from the stored lives (StreamAnalytics loads them itself).
        if (route === 'analytics' && platform === 'YouTube') {
          const value = await request<Report>('analytics', scopedDates);
          if (!cancelled) setReport(value);
        }
        if (route === 'revenue') {
          const value = await request<Revenue>('revenue', scopedDates);
          if (!cancelled) setRevenue(value);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route, selected, from, to, revision, platform]);

  const coverage = (items: Coverage[]) => (
    <div className="report-coverage">
      {items.map(c => (
        <div key={c.channelId}>
          <span>{c.name}</span>
          <strong>
            {(
              {
                available: 'Disponível',
                no_data: 'Sem linhas no período',
                not_synced: 'Ainda não coletado',
                permission_required: 'Permissão necessária',
                unavailable: 'Indisponível',
                reauthorization_required: 'Reconexão necessária',
              } as Record<string, string>
            )[c.status] ?? c.status}
          </strong>
          {c.reason && <p>{c.reason}</p>}
          {c.fetchedAt && <small>Coletado em {new Date(c.fetchedAt).toLocaleString('pt-BR')}</small>}
        </div>
      ))}
    </div>
  );
  return (
    <div className="live-workspace">
      {error && (
        <div role="alert" className="api-error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="api-message">
          {message}
        </div>
      )}
      {loading && !channels.length && route !== 'planner' && (
        <p className="api-note" role="status">
          Carregando dados do backend…
        </p>
      )}
      <Suspense fallback={<TabLoading />}>
        {route === 'planner' ? (
          // Global calendar: every connected platform, whatever the sidebar carousel shows.
          <StudioPlanner />
        ) : !loading && !error && !channels.length ? (
          <section className="panel empty">
            <Link2 size={30} />
            <h2>Conecte seu primeiro canal</h2>
            <p>Conecte um canal da plataforma selecionada para acompanhar seus dados.</p>
            <a href="#/settings" className="primary">
              Abrir conexões <ArrowRight size={15} />
            </a>
          </section>
        ) : (
          <>
            {route === 'analytics' && platform === 'YouTube' && report && <StudioAnalytics report={report} />}
            {route === 'analytics' && platform !== 'YouTube' && (
              <StreamAnalytics
                platform={platform}
                channelIds={channels.map(c => c.id)}
                from={from}
                to={to}
                revision={revision}
              />
            )}
            {route === 'revenue' && (
              <>
                {revenue && coverage(revenue.coverage)}
                <StudioFinance channels={channels} channelId={selected} from={from} to={to} revenue={revenue} />
              </>
            )}
            {route === 'community' && <StudioCommunity channels={channels} channelId={selected} />}
          </>
        )}
      </Suspense>
    </div>
  );
}

export function LiveWorkspace({ route }: { route: string }) {
  return route === 'home' ? <PlatformOverview /> : <WorkspaceSections route={route} />;
}
