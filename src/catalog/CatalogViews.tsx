import { ArrowRight, Eye, Heart, Layers } from 'lucide-react';
import { AnimatedNumber } from '../DataMotion';
import type { ApiChannel } from '../api';
import { money, num, type Playlist, type Video } from '../studioApi';
import { Spark } from '../VideoDrawer';

const percent = (value: number) => num(value) + '%';

/** Long-form videos: retention sparkline, totals and period views. A row opens the video report. */
export function VideoTable({
  items,
  channels,
  onSelect,
}: {
  items: Video[];
  channels: ApiChannel[];
  onSelect: (video: Video) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="studio-video-table">
        <thead>
          <tr>
            <th>Vídeo</th>
            <th>Retenção por trecho</th>
            <th>Views totais</th>
            <th>Média assistida</th>
            <th>Receita estimada (USD)</th>
            <th>Status</th>
            <th>Views no período</th>
          </tr>
        </thead>
        <tbody>
          {items.map(v => (
            <tr
              key={v.id}
              tabIndex={0}
              onClick={() => onSelect(v)}
              onKeyDown={e => {
                if (e.key === 'Enter') onSelect(v);
              }}
            >
              <td>
                <div className="video-cell">
                  <div className="thumb">
                    <img src={v.thumbnailUrl} alt="" />
                    <span>{v.duration}</span>
                  </div>
                  <div>
                    <strong>{v.title}</strong>
                    <small>
                      {v.date} · {channels.find(c => c.id === v.channelId)?.name}
                    </small>
                  </div>
                </div>
              </td>
              <td>
                <Spark values={v.retentionCurve?.map(r => r.audienceWatchRatio) ?? []} color="var(--accent)" />
              </td>
              <td>
                <AnimatedNumber value={v.views} format={num} />
              </td>
              <td>
                {v.averageViewPercentage === null ? (
                  '—'
                ) : (
                  <AnimatedNumber value={v.averageViewPercentage} format={percent} />
                )}
              </td>
              <td>
                <AnimatedNumber value={v.estimatedRevenue} format={money} />
              </td>
              <td>
                <span className="status">{v.status}</span>
              </td>
              <td>
                <Spark values={v.dailyViews?.map(r => r.views) ?? []} />
                <small>
                  <AnimatedNumber value={v.periodViews} format={num} />
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shorts as vertical cards. */
export function ShortsGrid({ items, onSelect }: { items: Video[]; onSelect: (video: Video) => void }) {
  return (
    <div className="shorts-grid">
      {items.map(v => (
        <button
          key={v.id}
          className="short-card"
          onClick={() => onSelect(v)}
          style={{
            backgroundImage: `linear-gradient(0deg,rgba(5,10,15,.96),transparent 70%),url(${v.thumbnailUrl})`,
          }}
        >
          <span className="glass-tag">{v.date}</span>
          <div>
            <h3>{v.title}</h3>
            <div className="short-metrics">
              <span>
                <Eye size={13} />
                <AnimatedNumber value={v.views} format={num} />
              </span>
              <span>
                <Heart size={13} />
                <AnimatedNumber value={v.likes} format={num} />
              </span>
              <span>
                {v.averageViewPercentage == null ? (
                  '—'
                ) : (
                  <AnimatedNumber value={v.averageViewPercentage} format={percent} />
                )}
              </span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

/** Imported playlists with their items; "Carregar mais" imports the next page of a playlist. */
export function PlaylistGrid({
  playlists,
  query,
  onOpenVideo,
  onLoadMore,
}: {
  playlists: Playlist[];
  query: string;
  onOpenVideo: (videoId: string) => void;
  onLoadMore: (playlist: Playlist) => void;
}) {
  const needle = query.toLocaleLowerCase();
  return (
    <div className="playlist-grid">
      {playlists
        .filter(p => p.title.toLocaleLowerCase().includes(needle))
        .map(pl => (
          <article className="panel playlist-card" key={pl.id}>
            <header>
              <img src={pl.thumbnailUrl} alt="" />
              <div>
                <h3>{pl.title}</h3>
                <p>{pl.description}</p>
                <small>
                  {pl.itemCount} vídeos · {pl.items.length} itens importados
                </small>
              </div>
              <a
                aria-label={'Abrir playlist ' + pl.title}
                href={'https://www.youtube.com/playlist?list=' + encodeURIComponent(pl.externalId)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Layers size={17} />
              </a>
            </header>
            {pl.items.map((item, i) => (
              <button className="playlist-item" key={item.id} onClick={() => onOpenVideo(item.videoId)}>
                <span>{i + 1}</span>
                <img src={item.thumbnailUrl} alt="" />
                <strong>{item.title}</strong>
                <ArrowRight size={13} />
              </button>
            ))}
            {pl.nextPageToken && <button onClick={() => onLoadMore(pl)}>Carregar mais vídeos</button>}
          </article>
        ))}
    </div>
  );
}
