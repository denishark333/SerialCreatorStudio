import { useEffect, useRef, useState } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { studioRequest, dateToday, daysAgo } from './studioApi';
type Job = {
  id: string;
  kind?: 'videos';
  status: string;
  phase: string;
  from: string;
  to: string;
  completedVideos: number;
  totalVideos: number;
  updatedAt: string;
  finishedAt?: string;
  errors: { message: string; phase?: string }[];
  warnings: unknown[];
};
type Status = {
  running: Job | null;
  queued: Job[];
  latest: Job | null;
  intervalMinutes: number;
  cadence?: { catalogHours: number; analyticsHours: number };
};
/** "agora mesmo", "há 12 min", "há 3 h", or the date for older runs. */
function ago(iso: string, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 24 * 60) return `há ${Math.floor(minutes / 60)} h`;
  return 'em ' + new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
const count = (job: Job) => (job.totalVideos ? `${job.completedVideos}/${job.totalVideos} conteúdos` : '');
export function GlobalSync({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [range, setRange] = useState(() => ({ from: daysAgo(dateToday(), 29), to: dateToday() }));
  const lastUpdate = useRef(''),
    lastRefresh = useRef(0);
  useEffect(() => {
    const listener = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v?.from && v?.to) setRange(old => (old.from === v.from && old.to === v.to ? old : v));
    };
    addEventListener('serial-sync-range', listener);
    return () => removeEventListener('serial-sync-range', listener);
  }, []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await studioRequest<Status>('sync/status');
        if (!active) return;
        setStatus(next);
        setError('');
        const job = next.running ?? next.latest;
        if (job && lastUpdate.current !== job.id + job.updatedAt) {
          lastUpdate.current = job.id + job.updatedAt;
          if (!next.running || Date.now() - lastRefresh.current >= 10000) {
            lastRefresh.current = Date.now();
            dispatchEvent(new CustomEvent('serial-data-updated'));
          }
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) timer = setTimeout(poll, 3000);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  async function trigger(force = false) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await studioRequest('sync', { method: 'POST', params: { ...range, force: String(force) } });
      setStatus(await studioRequest<Status>('sync/status'));
    } catch (e) {
      // A recent manual sync is not a failure: the data is up to date.
      if ((e as { code?: string }).code === 'SYNC_COOLDOWN') setNotice((e as Error).message);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void trigger(false);
  }, [range.from, range.to]);
  const job = status?.running ?? status?.latest;
  const running = !!status?.running;
  const completed = job?.status === 'completed';
  const videosQueued = !running && !!status?.queued.some(j => j.kind === 'videos');
  const cadence = status?.cadence;
  return (
    <section
      className={'global-sync' + (compact ? ' compact' : '') + (error ? ' has-error' : '')}
      aria-live="polite"
      title={error || job?.phase}
    >
      <div className="sync-symbol">
        {running ? (
          <RefreshCw size={18} className="sync-spin" />
        ) : completed ? (
          <CheckCircle2 size={18} />
        ) : job?.status === 'partial' || error ? (
          <AlertCircle size={18} />
        ) : (
          <Clock size={18} />
        )}
      </div>
      <div className="sync-description">
        <strong>
          {running
            ? 'Sincronização global em andamento'
            : completed
              ? 'Dados atualizados'
              : job?.status === 'partial'
                ? 'Coleta concluída com falhas'
                : job?.status === 'failed'
                  ? 'A coleta encontrou uma falha'
                  : 'Sincronização automática'}
        </strong>
        <span title={running ? job?.phase : error || undefined}>
          {error ||
            notice ||
            (running
              ? [job?.phase, job && count(job)].filter(Boolean).join(' · ')
              : job?.finishedAt
                ? 'Atualizado ' + ago(job.finishedAt) + (videosQueued ? ' · relatórios por vídeo na fila' : '')
                : cadence
                  ? `Catálogo e comentários a cada ${cadence.catalogHours} h · Analytics a cada ${cadence.analyticsHours} h · lives em tempo real`
                  : 'Catálogo, formatos, relatórios, playlists e comentários em uma única fila.')}
        </span>
        <small>
          {job ? (
            <>
              {[job.from + ' a ' + job.to, count(job), job.warnings.length + ' seções indisponíveis']
                .filter(Boolean)
                .join(' · ')}
            </>
          ) : (
            'Atualizações em segundo plano'
          )}
        </small>
      </div>
      <button
        aria-label={error || (running ? 'Sincronizando dados' : 'Sincronizar todos os canais')}
        title={
          error ||
          (running
            ? [job && count(job), job?.phase].filter(Boolean).join(' - ')
            : notice ||
              (job?.finishedAt
                ? 'Atualizado ' + ago(job.finishedAt) + '. Clique para buscar tudo de novo.'
                : 'Sincronizar todos os canais'))
        }
        disabled={busy || running}
        onClick={() => void trigger(true)}
      >
        <RefreshCw size={14} className={running ? 'sync-spin' : ''} />
        {compact ? (
          running && !!job?.totalVideos ? (
            <span>
              {job.completedVideos}/{job.totalVideos}
            </span>
          ) : null
        ) : running ? (
          'Sincronizando…'
        ) : (
          'Sincronizar tudo'
        )}
      </button>
      {job && job.errors.length > 0 && (
        <details>
          <summary>Ver falhas ({job.errors.length})</summary>
          {job.errors.map((e, i) => (
            <p key={i}>
              {e.phase ? e.phase + ': ' : ''}
              {e.message}
            </p>
          ))}
        </details>
      )}
      <div
        className="sync-progress"
        role="progressbar"
        aria-label="Progresso da sincronização"
        aria-valuemin={0}
        aria-valuemax={job?.totalVideos || 100}
        aria-valuenow={job?.completedVideos || 0}
      >
        <span
          style={{ width: (job?.totalVideos ? Math.min(100, (job.completedVideos / job.totalVideos) * 100) : 0) + '%' }}
        />
      </div>
    </section>
  );
}
