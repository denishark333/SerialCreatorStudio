import { usePlatform } from './PlatformContext';
import { useEffect, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Search, Upload } from 'lucide-react';
import {
  channels as loadChannels,
  studioRequest,
  dateToday,
  daysAgo,
  type Video,
  type Playlist,
  type Page,
} from './studioApi';
import type { ApiChannel } from './api';
import { VideoDrawer } from './VideoDrawer';
import { PlaylistGrid, ShortsGrid, VideoTable } from './catalog/CatalogViews';

/** Catálogo: imported videos, Shorts and playlists, with search, sorting and per-video reports. */
export function StudioCatalog({ search = '' }: { search?: string }) {
  const { platform, channels: allChannels } = usePlatform();
  const platformIds = allChannels.filter(c => c.platform === platform).map(c => c.id);
  const [tab, setTab] = useState('videos'),
    [items, setItems] = useState<Video[]>([]),
    [playlists, setPlaylists] = useState<Playlist[]>([]),
    [channels, setChannels] = useState<ApiChannel[]>([]),
    [channel, setChannel] = useState(''),
    [query, setQuery] = useState(search),
    [sort, setSort] = useState('date'),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [pages, setPages] = useState(0),
    [counts, setCounts] = useState({ videos: 0, shorts: 0, playlists: 0 }),
    [to, setTo] = useState(dateToday()),
    [from, setFrom] = useState(() => daysAgo(dateToday(), 29)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<Video | null>(null);
  useEffect(() => {
    const f = () => setRevision(v => v + 1);
    addEventListener('serial-data-updated', f);
    return () => removeEventListener('serial-data-updated', f);
  }, []);
  useEffect(() => {
    dispatchEvent(new CustomEvent('serial-sync-range', { detail: { from, to } }));
  }, [from, to]);
  useEffect(() => {
    const open = () => {
      const id = new URLSearchParams(location.hash.split('?')[1] ?? '').get('video');
      if (id && platformIds.length)
        void studioRequest<Page<Video>>('catalog', {
          params: { externalId: id, channelId: platformIds, limit: 1 },
          list: true,
        })
          .then(r => {
            if (r.data[0]) setSelected(r.data[0]);
          })
          .catch(e => setError(e.message));
    };
    open();
    addEventListener('hashchange', open);
    return () => removeEventListener('hashchange', open);
  }, [platformIds.join(',')]);
  useEffect(() => {
    setQuery(search);
  }, [search]);
  useEffect(() => {
    setPage(1);
  }, [query, channel, tab, sort]);
  useEffect(() => {
    let active = true;
    setBusy(items.length === 0 && playlists.length === 0);
    setError('');
    (async () => {
      try {
        const status = await studioRequest<{ items: unknown[] }>('connections');
        if (!status.items.length) {
          if (active) {
            setItems([]);
            setPlaylists([]);
            setChannels([]);
            setTotal(0);
          }
          return;
        }
        const ch = await loadChannels(platform);
        if (!ch.length) {
          if (active) {
            setItems([]);
            setPlaylists([]);
            setChannels([]);
            setTotal(0);
            setCounts({ videos: 0, shorts: 0, playlists: 0 });
          }
          return;
        }
        const params = {
          from,
          to,
          channelId: channel ? [channel] : ch.map(c => c.id),
          limit: 25,
          page,
          q: query,
          sort,
          ...(tab === 'shorts' ? { format: 'Short' } : tab === 'videos' ? { kind: 'videos' } : {}),
        };
        const [list, allCounts] = await Promise.all([
          tab === 'playlists'
            ? studioRequest<Page<Playlist>>('playlists', { params, list: true })
            : studioRequest<Page<Video>>('catalog', { params, list: true }),
          studioRequest<{ videos: number; shorts: number; playlists: number }>('catalog-summary', {
            params: { channelId: channel ? [channel] : ch.map(c => c.id) },
          }),
        ]);
        if (active) {
          setChannels(ch);
          setCounts(allCounts);
          setTotal(list.pagination.total);
          setPages(list.pagination.totalPages);
          if (tab === 'playlists') setPlaylists(list.data as Playlist[]);
          else setItems(list.data as Video[]);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tab, channel, query, sort, page, from, to, revision]);
  async function openPlaylistVideo(id: string) {
    try {
      const r = await studioRequest<Page<Video>>('catalog', {
        params: {
          channelId: playlists.find(p => p.items.some(i => i.videoId === id))?.channelId ?? platformIds,
          limit: 100,
        },
        list: true,
      });
      let video = r.data.find(v => v.externalId === id);
      if (!video) {
        const exact = await studioRequest<Page<Video>>('catalog', {
          params: { externalId: id, channelId: platformIds, limit: 1 },
          list: true,
        });
        video = exact.data[0];
      }
      if (video) setSelected(video);
      else setError('Importe este vídeo pelo catálogo para abrir o relatório.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="studio-heading-actions">
        <p className="muted">
          {counts.videos} vídeos · {counts.shorts} Shorts · {counts.playlists} playlists importadas
        </p>
        <a className="primary" href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer">
          <Upload size={15} />
          Publicar no Studio
        </a>
      </div>
      <div className="tabs studio-tabs">
        {[
          ['videos', 'Vídeos', counts.videos],
          ['shorts', 'Shorts', counts.shorts],
          ['playlists', 'Playlists', counts.playlists],
        ].map(([key, label, count]) => (
          <button key={key} className={tab === key ? 'selected' : ''} onClick={() => setTab(String(key))}>
            {label}
            <span>{count}</span>
          </button>
        ))}
      </div>
      {message && (
        <p className="api-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="api-error" role="alert">
          {error}
        </p>
      )}
      <section className={tab === 'videos' ? 'panel' : ''}>
        <div className="table-toolbar studio-catalog-toolbar">
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Pesquisar conteúdos"
              placeholder={tab === 'playlists' ? 'Pesquisar playlists…' : 'Pesquisar títulos e tags…'}
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </label>
          {tab !== 'playlists' && (
            <div className="segmented">
              {[
                ['date', 'Recentes'],
                ['views', 'Views'],
                ['retention', 'Média assistida'],
                ['revenue', 'Receita'],
              ].map(([key, label]) => (
                <button className={sort === key ? 'selected' : ''} key={key} onClick={() => setSort(key)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {busy ? (
          <div className="empty" role="status">
            Carregando conteúdos…
          </div>
        ) : tab === 'videos' ? (
          <VideoTable items={items} channels={channels} onSelect={setSelected} />
        ) : tab === 'shorts' ? (
          <ShortsGrid items={items} onSelect={setSelected} />
        ) : (
          <PlaylistGrid
            playlists={playlists}
            query={query}
            onOpenVideo={id => void openPlaylistVideo(id)}
            onLoadMore={pl =>
              void studioRequest(`playlists/${pl.id}/more`, { method: 'POST' })
                .then(() => setRevision(v => v + 1))
                .catch(e => setError(e.message))
            }
          />
        )}
        {!busy && total === 0 && (
          <div className="empty">
            <h3>Nenhum {tab === 'shorts' ? 'Short' : tab === 'playlists' ? 'playlist' : 'vídeo'} encontrado</h3>
            <p>
              {tab === 'shorts'
                ? 'A sincronização global identifica os Shorts automaticamente; acompanhe o progresso acima.'
                : tab === 'playlists'
                  ? 'As playlists serão importadas pela sincronização global.'
                  : 'Importe o catálogo em Conexões ou altere a pesquisa.'}
            </p>
            <a className="text-link" href="#/settings">
              Abrir conexões <ArrowRight size={14} />
            </a>
          </div>
        )}
      </section>
      {total > 0 && (
        <div className="studio-pagination">
          <span>
            {total} resultados · página {page} de {pages}
          </span>
          <button aria-label="Página anterior" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={16} />
          </button>
          <button aria-label="Próxima página" disabled={page >= pages || busy} onClick={() => setPage(page + 1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
      {selected && (
        <VideoDrawer
          video={selected}
          from={from}
          to={to}
          onClose={() => setSelected(null)}
          onChanged={() => setRevision(v => v + 1)}
        />
      )}
    </>
  );
}
