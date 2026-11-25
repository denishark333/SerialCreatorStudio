import { AnimatedNumber } from './DataMotion';
import { Members, useMemberships } from './Members';
import { useEffect, useState } from 'react';
import {
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Pin,
  EyeOff,
  RefreshCw,
  Search,
  ThumbsUp,
  Send,
  Trash2,
} from 'lucide-react';
import { confirmAction } from './ConfirmDialog';
import { studioRequest, num, type Page, type Comment } from './studioApi';
import type { ApiChannel } from './api';
import { handleYouTubeLink } from './youtubeWindow';
/**
 * Watch-page link with `lc=` so YouTube highlights this comment at the top of the thread.
 * Heart and pin are only possible there: the official Data API v3 `comments` resource has no
 * operation (or field) for them, and automating YouTube Studio's private endpoints would breach the API terms.
 */
const commentUrl = (c: Comment) =>
  `https://www.youtube.com/watch?v=${encodeURIComponent(c.videoId ?? '')}&lc=${encodeURIComponent(c.externalId ?? '')}`;
export function StudioCommunity({ channels, channelId }: { channels: ApiChannel[]; channelId: string }) {
  const { value: membershipAccess } = useMemberships(channels, channelId);
  const [tab, setTab] = useState('comments');
  const [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [items, setItems] = useState<Comment[]>([]),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [revision, setRevision] = useState(0),
    [reply, setReply] = useState<string | null>(null),
    [text, setText] = useState(''),
    [requestId, setRequestId] = useState(''),
    [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => {
    const f = () => setRevision(v => v + 1);
    addEventListener('serial-data-updated', f);
    return () => removeEventListener('serial-data-updated', f);
  }, []);
  useEffect(() => setPage(1), [channelId, query, filter]);
  useEffect(() => {
    let active = true;
    if (!channels.length) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    if (!items.length) setLoading(true);
    setError('');
    studioRequest<Page<Comment>>('community/comments', {
      params: { channelId: channelId ? [channelId] : channels.map(c => c.id), q: query, filter, page, limit: 25 },
      list: true,
    })
      .then(r => {
        if (active) {
          setItems(filter === 'members' ? r.data.filter(c => c.membership?.status === 'member') : r.data);
          setTotal(r.pagination.total);
        }
      })
      .catch(e => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [channelId, query, filter, page, revision, channels.map(c => c.id).join(',')]);
  /**
   * YouTube moderation: "Ocultar" holds the comment for review (reversible, listed in YouTube Studio > Held for
   * review); "Republicar" publishes it again; "Excluir" removes it from the video for good, so it asks first.
   */
  async function moderate(c: Comment, status: 'heldForReview' | 'published' | 'rejected') {
    if (
      status === 'rejected' &&
      !(await confirmAction({
        title: 'Excluir comentário?',
        message:
          'O comentário e as respostas dele serão removidos do vídeo no YouTube. Essa ação não pode ser desfeita: o comentário não aparece no YouTube Studio e não pode ser republicado.',
        confirmLabel: 'Excluir comentário',
        tone: 'danger',
      }))
    )
      return;
    setBusy(true);
    setError('');
    try {
      await studioRequest(`community/comments/${c.id}/moderation`, { method: 'POST', body: { status } });
      setMessage(
        status === 'heldForReview'
          ? 'Comentário ocultado no YouTube. Ele fica em Ocultos e pode ser republicado.'
          : status === 'published'
            ? 'Comentário republicado no YouTube.'
            : 'Comentário excluído do YouTube.',
      );
      setRevision(v => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish(c: Comment) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await studioRequest(`community/comments/${c.id}/publish-reply`, { method: 'POST', body: { text, requestId } });
      setReply(null);
      setText('');
      setMessage('Resposta publicada no YouTube.');
      setRevision(v => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const openReply = (c: Comment) => {
    setReply(c.id);
    setText('');
    setRequestId(crypto.randomUUID());
  };
  return (
    <>
      <div className="tabs">
        <button className={tab === 'comments' ? 'selected' : ''} onClick={() => setTab('comments')}>
          Comentários <span>{total}</span>
        </button>
        <button className={tab === 'members' ? 'selected' : ''} onClick={() => setTab('members')}>
          Membros
        </button>
      </div>
      {tab === 'members' ? (
        <Members channels={channels} channelId={channelId} />
      ) : (
        <>
          {error && (
            <p className="api-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="api-message" role="status">
              {message}
            </p>
          )}
          <section className="panel studio-community">
            <div className="table-toolbar community-toolbar">
              <div className="segmented">
                {[
                  ['all', 'Todos'],
                  ['members', 'Membros'],
                  ['questions', 'Perguntas (?)'],
                  ['answered', 'Respondidos'],
                  ['hidden', 'Ocultos no YouTube'],
                ].map(([key, label]) => (
                  <button key={key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="search">
                <Search size={15} />
                <input
                  aria-label="Pesquisar comentários"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Pesquisar comentários…"
                />
              </label>
            </div>
            {filter === 'members' && membershipAccess?.status !== 'available' && (
              <p className="api-note">
                Não foi possível confirmar todos os membros nesta conexão. A lista mostra apenas comentários de membros
                identificados pela coleta autorizada.
              </p>
            )}
            {loading ? (
              <div className="empty" role="status">
                Carregando comentários…
              </div>
            ) : (
              items.map(c => (
                <article className="comment studio-comment" key={c.id}>
                  <div className="avatar">{c.author.slice(0, 2).toUpperCase()}</div>
                  <div className="comment-body">
                    <div className="comment-author">
                      <strong>{c.author}</strong>
                      {c.membership?.status === 'member' && (
                        <span className="member-badge" title="Membro identificado na última coleta">
                          {c.membership.member?.levelName ?? 'Membro'}
                        </span>
                      )}
                      <span>{channels.find(ch => ch.id === c.channelId)?.name}</span>
                      <small>{c.publishedAt ? new Date(c.publishedAt).toLocaleString('pt-BR') : ''}</small>
                      {c.text.includes('?') && <span className="status">Pergunta</span>}
                    </div>
                    <p className="comment-text">{c.text}</p>
                    <a
                      className="comment-video"
                      href={commentUrl(c)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={handleYouTubeLink}
                    >
                      {c.video?.thumbnailUrl && <img src={c.video.thumbnailUrl} alt="" />}
                      <span>em “{c.video?.title ?? 'Vídeo ' + (c.videoId ?? 'não identificado')}”</span>
                      <ExternalLink size={11} />
                    </a>
                    <div className="comment-actions">
                      <a
                        className="text-link"
                        href={commentUrl(c)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={handleYouTubeLink}
                        aria-label="Heart: abrir o comentário no YouTube"
                        title="Abre o comentário destacado no YouTube para dar o coração. A API oficial do YouTube não oferece essa ação nem informa se o comentário já tem coração."
                      >
                        <Heart size={14} />
                        Heart <ExternalLink size={11} />
                      </a>
                      <span className="muted">
                        <ThumbsUp size={13} /> <AnimatedNumber value={c.likeCount} format={num} />
                      </span>
                      <button
                        disabled={
                          c.canReply === false ||
                          c.platform !== 'YouTube' ||
                          c.youtubeModerationStatus === 'heldForReview'
                        }
                        title={
                          c.youtubeModerationStatus === 'heldForReview'
                            ? 'Republique o comentário para responder.'
                            : undefined
                        }
                        onClick={() => openReply(c)}
                      >
                        <MessageCircle size={14} />
                        Responder
                      </button>
                      <a
                        className="text-link"
                        aria-label="Pin: abrir o comentário no YouTube"
                        title="Abre o comentário destacado no YouTube para fixá-lo (menu ⋮ → Fixar). A API oficial do YouTube não oferece essa ação nem informa se o comentário está fixado."
                        href={commentUrl(c)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={handleYouTubeLink}
                      >
                        <Pin size={14} />
                        Pin <ExternalLink size={11} />
                      </a>
                      {c.youtubeModerationStatus === 'heldForReview' ? (
                        <button disabled={busy} onClick={() => void moderate(c, 'published')}>
                          <Eye size={14} />
                          Republicar no YouTube
                        </button>
                      ) : (
                        <button disabled={busy} onClick={() => void moderate(c, 'heldForReview')}>
                          <EyeOff size={14} />
                          Ocultar no YouTube
                        </button>
                      )}
                      <button className="danger-button" disabled={busy} onClick={() => void moderate(c, 'rejected')}>
                        <Trash2 size={14} />
                        Excluir comentário
                      </button>
                    </div>
                    {reply === c.id && (
                      <form
                        className="studio-reply"
                        onSubmit={e => {
                          e.preventDefault();
                          void publish(c);
                        }}
                      >
                        <label>
                          Sua resposta pública
                          <textarea
                            required
                            maxLength={5000}
                            autoFocus
                            value={text}
                            onChange={e => {
                              setText(e.target.value);
                              setRequestId(crypto.randomUUID());
                            }}
                            placeholder="Escreva a resposta que será publicada no YouTube…"
                          />
                        </label>
                        <div>
                          <button type="button" onClick={() => setReply(null)}>
                            Cancelar
                          </button>
                          <button className="primary" disabled={busy || !text.trim()}>
                            <Send size={14} />
                            {busy ? 'Enviando…' : 'Enviar ao YouTube'}
                          </button>
                        </div>
                      </form>
                    )}
                    {(c.replies?.length ?? 0) > 0 && (
                      <button
                        className="thread-toggle"
                        onClick={() =>
                          setExpanded(v => (v.includes(c.id) ? v.filter(id => id !== c.id) : [...v, c.id]))
                        }
                      >
                        {expanded.includes(c.id) ? 'Recolher conversa' : 'Ver conversa'} ({c.replies.length})
                      </button>
                    )}
                    {c.repliesSyncStatus === 'unavailable' && (
                      <p className="footnote">Não foi possível atualizar todas as respostas: {c.repliesError}</p>
                    )}
                    {expanded.includes(c.id) &&
                      c.replies?.map(r => (
                        <div className="published-reply" key={r.id}>
                          <strong>
                            {r.isOwner ? 'Resposta do seu canal' : (r.author ?? 'Resposta')} ·{' '}
                            {r.createdAt ? new Date(r.createdAt).toLocaleString('pt-BR') : ''}
                          </strong>
                          <p className="comment-text">{r.text}</p>
                        </div>
                      ))}
                  </div>
                </article>
              ))
            )}
            {!loading && !items.length && <div className="empty">Nenhum comentário encontrado neste filtro.</div>}
            <div className="studio-pagination">
              <span>
                {total} comentários · página {page}
              </span>
              <button disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
                Anterior
              </button>
              <button disabled={page * 25 >= total || loading} onClick={() => setPage(page + 1)}>
                Próxima
              </button>
            </div>
          </section>
        </>
      )}
    </>
  );
}
