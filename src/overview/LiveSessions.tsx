import { useEffect, useState } from 'react';
import { BadgeDollarSign, Gem, MessageSquare, Radio, Swords, UserPlus } from 'lucide-react';
import type { Platform } from '../api';
import { num, studioRequest } from '../studioApi';

export type LiveSession = {
  id: string;
  channelId: string;
  platform: Platform;
  title: string | null;
  game: string | null;
  startedAt: string;
  date: string;
  time: string;
  live: boolean;
  minutes: number;
  samples: number;
  avgViewers: number | null;
  peakViewers: number | null;
  minutesWatched: number | null;
  followersGained: number | null;
  subs: number;
  resubs: number;
  gifts: number;
  bits: number;
  raids: { from: string | null; fromLogin: string | null; viewers: number; at: string }[];
  chat: { messages: number; chatters: number } | null;
  tracking: { events: boolean; chat: boolean };
};

const duration = (minutes: number) => {
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
};
const day = (date: string) => date.slice(8, 10) + '/' + date.slice(5, 7);

/**
 * Broadcasts of the period, one row each: viewers sampled by the sync (average, peak, estimated minutes watched),
 * followers gained, and — on Twitch, from EventSub — raids received, new subs/gifts, bits and unique chatters.
 */
export function LiveSessions({
  platform,
  channelIds,
  from,
  to,
  revision,
}: {
  platform: Platform;
  channelIds: string[];
  from: string;
  to: string;
  revision: number;
}) {
  const [sessions, setSessions] = useState<LiveSession[] | null>(null),
    [error, setError] = useState('');
  const scope = channelIds.join(',');
  useEffect(() => {
    let active = true;
    setError('');
    studioRequest<LiveSession[]>('streams/sessions', { params: { channelId: scope.split(','), from, to } })
      .then(rows => active && setSessions(rows))
      .catch(e => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [scope, from, to, revision]);
  const twitch = platform === 'Twitch';
  return (
    <section className="panel live-sessions">
      <div className="section-head">
        <h2>Lives do período</h2>
        {sessions && <span className="platform-count">{sessions.length}</span>}
      </div>
      {error ? (
        <p className="api-error" role="alert">
          {error}
        </p>
      ) : !sessions ? (
        <p className="muted">Carregando lives…</p>
      ) : !sessions.length ? (
        <div className="empty">
          <Radio size={22} />
          <p>Nenhuma live registrada neste período. As lives aparecem a partir das próximas coletas.</p>
        </div>
      ) : (
        <ol className="live-session-list">
          {sessions.map(s => (
            <li key={s.id} className={s.live ? 'is-live' : ''}>
              <div className="live-session-head">
                <time dateTime={s.startedAt}>
                  {day(s.date)} · {s.time}
                </time>
                <strong title={s.title ?? undefined}>{s.title || 'Live'}</strong>
                <small>{[s.game, duration(s.minutes), s.live ? 'ao vivo' : null].filter(Boolean).join(' · ')}</small>
              </div>
              <dl className="live-session-stats">
                <div>
                  <dt>Média</dt>
                  <dd>{num(s.avgViewers)}</dd>
                </div>
                <div>
                  <dt>Pico</dt>
                  <dd>{num(s.peakViewers)}</dd>
                </div>
                <div>
                  <dt title="Minutos assistidos (estimados)">Min. vistos</dt>
                  <dd>{s.minutesWatched === null ? '—' : '~' + num(s.minutesWatched)}</dd>
                </div>
                <div>
                  <dt>
                    <UserPlus size={11} aria-hidden="true" /> Seguidores
                  </dt>
                  <dd>
                    {s.followersGained === null ? '—' : (s.followersGained > 0 ? '+' : '') + num(s.followersGained)}
                  </dd>
                </div>
                {twitch && (
                  <>
                    <div>
                      <dt>
                        <BadgeDollarSign size={11} aria-hidden="true" /> Subs
                      </dt>
                      <dd title={`${s.subs} novos · ${s.resubs} renovações · ${s.gifts} presenteados`}>
                        {num(s.subs + s.resubs + s.gifts)}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Gem size={11} aria-hidden="true" /> Bits
                      </dt>
                      <dd>{num(s.bits)}</dd>
                    </div>
                    <div>
                      <dt>
                        <MessageSquare size={11} aria-hidden="true" /> No chat
                      </dt>
                      <dd
                        title={
                          s.chat
                            ? `${num(s.chat.chatters)} participantes únicos · ${num(s.chat.messages)} mensagens`
                            : undefined
                        }
                      >
                        {s.chat ? num(s.chat.chatters) : s.tracking.chat ? '—' : 'reconecte'}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              {s.raids.length > 0 && (
                <p className="live-session-raids">
                  <Swords size={12} aria-hidden="true" />
                  {s.raids.length === 1 ? 'Raid de ' : 'Raids de '}
                  {s.raids.map(r => `${r.from ?? 'Canal'} (${num(r.viewers)})`).join(', ')}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="footnote">
        Média e pico vêm das coletas a cada 30 min; minutos assistidos são estimados (média × duração).
        {twitch &&
          ' Subs, bits, raids e chat são registrados em tempo real enquanto o backend está conectado à Twitch.'}
      </p>
    </section>
  );
}
