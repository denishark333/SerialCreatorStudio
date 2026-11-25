import { usePlatform } from './PlatformContext';
import { PlatformIcon } from './PlatformIcon';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Link2, RefreshCw } from 'lucide-react';
import { channels as loadChannels, studioRequest, dateToday, daysAgo } from './studioApi';
import { apiSession } from './apiSession';
import type { ApiChannel, Platform } from './api';
import type { Report } from './liveTypes';
import { StudioOverview } from './StudioOverview';
import { StreamOverview } from './StreamOverview';
type Filters = { channel: string };
const platforms: Platform[] = ['YouTube', 'Twitch', 'Kick'];
const initial = (): Filters => ({ channel: '' });
export function PlatformOverview() {
  const { platform, setPlatform, channels } = usePlatform();
  const loaded = true;
  const [youtubeFormat, setYoutubeFormat] = useState<'Vídeo' | 'Short'>('Vídeo'),
    [filters, setFilters] = useState<Record<Platform, Filters>>(() => ({
      YouTube: initial(),
      Twitch: initial(),
      Kick: initial(),
    })),
    [reports, setReports] = useState<Record<string, Report>>({}),
    [fetching, setFetching] = useState(''),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(v => v + 1);
    addEventListener('serial-data-updated', refresh);
    return () => removeEventListener('serial-data-updated', refresh);
  }, []);
  const to = dateToday(),
    from = daysAgo(to, 29);
  const state = filters[platform],
    available = channels.filter(c => c.platform === platform),
    selected = available.some(c => c.id === state.channel) ? state.channel : '',
    visible = available.filter(c => !selected || c.id === selected),
    scope = visible
      .map(c => c.id)
      .sort()
      .join(','),
    cacheKey = [platform, scope, from, to].join('|');
  const change = (patch: Partial<Filters>) =>
    setFilters(current => ({ ...current, [platform]: { ...current[platform], ...patch } }));
  useEffect(() => {
    if (!loaded || platform !== 'YouTube' || !scope) return;
    let active = true;
    setFetching(cacheKey);
    setError('');
    studioRequest<Report>('overview', { params: { platform, channelId: scope.split(','), from: from, to: to } })
      .then(report => {
        if (active) setReports(previous => ({ ...previous, [cacheKey]: report }));
      })
      .catch(e => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setFetching('');
      });
    return () => {
      active = false;
    };
  }, [platform, scope, from, to, revision, loaded]);
  useEffect(() => {
    dispatchEvent(new CustomEvent('serial-sync-range', { detail: { from: from, to: to } }));
  }, [from, to]);
  return (
    <div className="platform-overview">
      <div className="platform-switches" role="group" aria-label="Plataforma da visão geral">
        {platforms.map(p => (
          <button
            key={p}
            className={platform === p ? 'selected' : ''}
            aria-pressed={platform === p}
            onClick={() => {
              setPlatform(p);
              setError('');
            }}
          >
            <PlatformIcon platform={p} />
            {p}
            <small>{channels.filter(c => c.platform === p).length}</small>
          </button>
        ))}
      </div>
      {platform === 'YouTube' && available.length > 0 && (
        <div className="tabs studio-tabs overview-format-tabs" role="group" aria-label="Formato em destaque no YouTube">
          {(
            [
              ['Vídeo', 'Vídeos'],
              ['Short', 'Shorts'],
            ] as const
          ).map(([format, label]) => (
            <button
              key={format}
              className={youtubeFormat === format ? 'selected' : ''}
              aria-pressed={youtubeFormat === format}
              onClick={() => setYoutubeFormat(format)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="api-error" role="alert">
          {error}
        </p>
      )}
      {!loaded ? (
        <div className="overview-skeleton" role="status">
          Carregando seus canais…
        </div>
      ) : !available.length ? (
        <section className="panel empty">
          <Link2 size={28} />
          <h2>Conecte seu canal da {platform}</h2>
          <a href="#/settings" className="primary">
            Abrir Conexões <ArrowRight size={15} />
          </a>
        </section>
      ) : platform === 'YouTube' ? (
        reports[cacheKey] ? (
          <StudioOverview
            contentFormat={youtubeFormat}
            key={cacheKey + '|' + youtubeFormat}
            report={reports[cacheKey]}
            channels={visible}
            from={from}
            to={to}
          />
        ) : (
          <div className="overview-skeleton" role="status">
            {error ? 'Não foi possível carregar os dados deste canal.' : 'Carregando a visão geral do YouTube…'}
          </div>
        )
      ) : (
        <StreamOverview revision={revision} key={cacheKey} platform={platform} channels={visible} from={from} to={to} />
      )}
    </div>
  );
}
