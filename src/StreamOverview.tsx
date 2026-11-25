import { AnimatedNumber } from './DataMotion';
import { useEffect, useState } from 'react';
import { ArrowRight, ExternalLink, Radio, Users, Video, Wallet } from 'lucide-react';
import type { ApiChannel, ApiPlan, Platform } from './api';
import { dateToday, daysAgo, studioRequest, num, type Page, type Video as Content } from './studioApi';
import { NextPlan } from './overview/NextPlan';
import { StreamGoal } from './overview/StreamGoal';
import { LiveSessions } from './overview/LiveSessions';
import { TwitchRevenue } from './overview/TwitchRevenue';
export function StreamOverview({
  platform,
  channels,
  from,
  to,
  revision,
}: {
  platform: Platform;
  channels: ApiChannel[];
  from: string;
  to: string;
  revision: number;
}) {
  const [contents, setContents] = useState<Content[]>([]),
    [plans, setPlans] = useState<ApiPlan[]>([]),
    [error, setError] = useState('');
  const scope = channels
    .map(c => c.id)
    .sort()
    .join(',');
  useEffect(() => {
    let active = true;
    const channelId = scope.split(',');
    setError('');
    Promise.allSettled([
      platform === 'Twitch'
        ? studioRequest<Page<Content>>('catalog', {
            params: { channelId, from, to, limit: 8, sort: 'date' },
            list: true,
          })
        : Promise.resolve({ data: [] as Content[] }),
      // Upcoming plans (today onward), not the overview's past period: same card as the YouTube overview.
      studioRequest<Page<ApiPlan>>('plans', {
        params: { channelId, from: dateToday(), to: daysAgo(dateToday(), -180), limit: 3 },
        list: true,
      }),
    ]).then(([catalog, planning]) => {
      if (!active) return;
      if (catalog.status === 'fulfilled') setContents(catalog.value.data);
      else setError(catalog.reason.message);
      if (planning.status === 'fulfilled') setPlans(planning.value.data);
    });
    return () => {
      active = false;
    };
  }, [platform, scope, from, to, revision]);
  const live = channels.filter(c => c.live?.isLive),
    hero = live[0] ?? channels[0],
    latest = contents[0],
    viewers =
      channels.some(c => !c.live) || live.some(c => c.live?.viewers == null)
        ? null
        : live.reduce((n, c) => n + (c.live?.viewers ?? 0), 0);
  const total = (key: 'followers' | 'paidSubscribers') =>
    channels.every(c => c[key] != null) ? channels.reduce((n, c) => n + (c[key] ?? 0), 0) : null;
  const timestamp = channels
    .map(c => c.lastSyncedAt)
    .filter(Boolean)
    .sort()[0];
  return (
    <div className="stream-overview">
      {error && (
        <p className="api-error" role="alert">
          {error}
        </p>
      )}
      <div className="overview-hero-grid home-grid">
        <section
          className="panel platform-live-hero"
          style={
            latest?.thumbnailUrl
              ? { backgroundImage: `linear-gradient(0deg,#0b1018f5,#0b101866),url(${latest.thumbnailUrl})` }
              : {}
          }
        >
          <span className="glass-tag">
            <Radio size={13} />
            {live.length ? 'Ao vivo na última coleta' : 'Transmissões e catálogo'} · {platform}
          </span>
          <div>
            <h2>{hero.live?.title || hero.name}</h2>
            <p>
              {live.length
                ? `${live.length} ${live.length === 1 ? 'canal transmitindo' : 'canais transmitindo'}`
                : channels.some(c => !c.live)
                  ? 'Aguardando a primeira coleta'
                  : 'Nenhum canal ao vivo na última coleta'}
            </p>
            <div className="platform-hero-metrics">
              <strong>
                <AnimatedNumber value={viewers} format={num} />
                <small>espectadores na última coleta</small>
              </strong>
              <strong>
                <AnimatedNumber value={total('followers')} format={num} />
                <small>seguidores</small>
              </strong>
            </div>
            {hero.watchUrl && (
              <a className="primary" href={hero.watchUrl} target="_blank" rel="noopener noreferrer">
                Abrir canal <ExternalLink size={15} />
              </a>
            )}
          </div>
        </section>
        <section className="panel next-panel">
          <div className="section-head">
            <h2>Canais da {platform}</h2>
            <span className="platform-count">{channels.length}</span>
          </div>
          {channels.map(c => (
            <div className="platform-channel-row" key={c.id}>
              {c.thumbnailUrl && <img src={c.thumbnailUrl} alt="" />}
              <div>
                <strong>{c.name}</strong>
                <small>
                  {!c.live
                    ? 'Aguardando coleta'
                    : c.live.isLive
                      ? 'Ao vivo · ' + num(c.live.viewers) + ' espectadores'
                      : 'Fora do ar'}
                </small>
              </div>
              <span className={'live-state' + (c.live?.isLive ? ' on' : '')} />
            </div>
          ))}
          <p className="footnote">
            {timestamp
              ? 'Última coleta: ' + new Date(timestamp).toLocaleString('pt-BR')
              : 'Sincronize os canais para atualizar o status.'}
          </p>
          <p className="footnote">
            A API não fornece a curva de retenção de vídeos ou os relatórios de receita do estúdio.
          </p>
        </section>
      </div>
      <div className="stats platform-stream-stats">
        {[
          {
            label: 'Seguidores',
            value: <AnimatedNumber value={total('followers')} format={num} />,
            icon: Users,
            color: 'mint',
          },
          {
            label: 'Inscrições pagas',
            value: <AnimatedNumber value={total('paidSubscribers')} format={num} />,
            icon: Wallet,
            color: 'lavender',
          },
          {
            label: 'Espectadores na coleta',
            value: <AnimatedNumber value={viewers} format={num} />,
            icon: Radio,
            color: 'sand',
          },
        ].map(item => (
          <article className={'stat ' + item.color} key={item.label}>
            <span>
              <item.icon size={15} />
              {item.label}
            </span>
            <strong>{item.value}</strong>
            <small className="muted">{platform} · canais selecionados</small>
          </article>
        ))}
      </div>
      <div className="studio-overview-grid home-grid">
        <section className="panel">
          <div className="section-head live-section-head">
            <h2>{platform === 'Twitch' ? 'VODs, vídeos e clipes' : 'Conteúdos do canal'}</h2>
            <a href="#/content">
              Conteúdo <ArrowRight size={14} />
            </a>
          </div>
          {platform === 'Kick' ? (
            <div className="empty platform-catalog-empty">
              <Video size={25} />
              <p>A API Kick não disponibiliza o catálogo de VODs.</p>
            </div>
          ) : contents.length ? (
            contents.map(v => (
              <a
                className="platform-content-row"
                key={v.id}
                href={v.watchUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img src={v.thumbnailUrl} alt="" />
                <div>
                  <strong>{v.title}</strong>
                  <small>
                    {v.date} · {v.format} · {v.duration}
                  </small>
                </div>
                <b>
                  <AnimatedNumber value={v.views} format={num} />
                  <small>views totais</small>
                </b>
              </a>
            ))
          ) : (
            <div className="empty">Nenhum conteúdo importado neste período.</div>
          )}
        </section>
        {/* Right column: cards keep their own height (they don't stretch to the content list). */}
        <div>
          <NextPlan plans={plans} />
          <StreamGoal
            platform={platform}
            followers={total('followers')}
            subscribers={total('paidSubscribers')}
            onError={setError}
          />
        </div>
      </div>
      <div className={'live-stats-grid' + (platform === 'Twitch' ? ' with-revenue' : '')}>
        <LiveSessions platform={platform} channelIds={scope.split(',')} from={from} to={to} revision={revision} />
        {platform === 'Twitch' && <TwitchRevenue channelIds={scope.split(',')} revision={revision} />}
      </div>
    </div>
  );
}
