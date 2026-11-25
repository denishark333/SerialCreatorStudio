import { ArrowRight, MessageCircle } from 'lucide-react';
import type { Comment } from '../studioApi';

/** Latest comments containing "?" (text filter), linking to the Community tab. */
export function CommunityQuestions({ comments }: { comments: Comment[] }) {
  return (
    <section className="panel comments overview-questions">
      <div className="section-head">
        <div>
          <h2>Perguntas da comunidade</h2>
          <p>Comentários com “?” · filtro de texto</p>
        </div>
        <a href="#/community">
          Abrir caixa de entrada <MessageCircle size={14} />
        </a>
      </div>
      {comments.map(c => (
        <article className="comment" key={c.id}>
          <div className="avatar">{c.author.slice(0, 2)}</div>
          <div className="comment-body">
            <strong>{c.author}</strong>
            <p className="comment-text">{c.text}</p>
            <a className="text-link" href="#/community">
              Responder na Comunidade <ArrowRight size={14} />
            </a>
          </div>
        </article>
      ))}
      {!comments.length && <p className="api-note">Nenhuma pergunta importada nos canais selecionados.</p>}
    </section>
  );
}
