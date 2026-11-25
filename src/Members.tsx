import { AnimatedNumber } from './DataMotion';
import { useEffect, useState } from 'react';
import { Crown, Search } from 'lucide-react';
import { studioRequest, num } from './studioApi';
import type { ApiChannel } from './api';
export type Member = {
  externalId: string;
  name: string;
  thumbnailUrl: string | null;
  levelId: string | null;
  levelName: string | null;
  memberSince: string | null;
  months: number | null;
  channelId: string;
  channelName: string;
};
export type Memberships = {
  status: string;
  total: number | null;
  knownCount: number;
  levels: { id: string; channelId: string; channelName: string; name: string; count: number }[];
  coverage: { channelId: string; name: string; status: string; reason: string | null; checkedAt: string | null }[];
  items: Member[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  revenue: { amount: number | null; currency: string | null; reason: string };
};
export function useMemberships(channels: ApiChannel[], channelId = '', page = 1, q = '') {
  const [value, setValue] = useState<Memberships | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  const ids = (channelId ? [channelId] : channels.map(c => c.id)).join(',');
  useEffect(() => {
    const update = () => setRevision(v => v + 1);
    addEventListener('serial-data-updated', update);
    return () => removeEventListener('serial-data-updated', update);
  }, []);
  useEffect(() => {
    let active = true;
    if (!ids) {
      setValue(null);
      return;
    }
    setLoading(!value);
    setError('');
    studioRequest<Memberships>('community/members', { params: { channelId: ids.split(','), page, limit: 25, q } })
      .then(data => {
        if (active && Array.isArray(data.coverage)) setValue(data);
      })
      .catch(() => {
        if (active)
          setError(
            'Não foi possível consultar os membros. Verifique se a API da VPS está atualizada e se a conexão tem acesso a membros.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ids, page, q, revision]);
  return { value, error, loading };
}
export function Members({ channels, channelId }: { channels: ApiChannel[]; channelId: string }) {
  const [page, setPage] = useState(1),
    [q, setQuery] = useState('');
  const { value, error, loading } = useMemberships(channels, channelId, page, q);
  return (
    <div className="members-view">
      {error && (
        <p className="api-note" role="status">
          {error}
        </p>
      )}
      <div className="membership-tiers">
        {value?.levels.map(level => (
          <article className="panel membership-tier" key={level.channelId + level.id}>
            <Crown size={18} />
            <h2>{level.name}</h2>
            <strong>
              <AnimatedNumber value={level.count} format={num} /> <small>membros</small>
            </strong>
            <span>{level.channelName}</span>
          </article>
        ))}
        <article className="panel membership-tier membership-total">
          <span>Membros pagantes</span>
          <strong>
            <AnimatedNumber value={value?.total} format={num} />
          </strong>
          <small>
            {value?.status === 'partial'
              ? 'Cobertura parcial · ' + num(value.knownCount) + ' identificados'
              : 'Na última coleta completa'}
          </small>
        </article>
      </div>
      {value?.coverage
        .filter(c => c.status !== 'available')
        .map(c => (
          <p className="api-note" role="status" key={c.channelId}>
            <strong>{c.name}:</strong> {c.reason}
          </p>
        ))}
      <section className="panel members-list">
        <header className="section-head">
          <div>
            <h2>Membros do canal</h2>
            <p>Plano atual e tempo de apoio</p>
          </div>
          <label className="search">
            <Search size={15} />
            <input
              aria-label="Pesquisar membros"
              placeholder="Pesquisar membros…"
              value={q}
              onChange={e => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Membro</th>
                <th>Plano</th>
                <th>Canal</th>
                <th>Desde</th>
                <th>Meses</th>
              </tr>
            </thead>
            <tbody>
              {value?.items.map(m => (
                <tr key={m.channelId + m.externalId}>
                  <td>
                    <div className="member-person">
                      {m.thumbnailUrl ? (
                        <img src={m.thumbnailUrl} alt="" />
                      ) : (
                        <span className="avatar">{m.name.slice(0, 2)}</span>
                      )}
                      <strong>{m.name}</strong>
                    </div>
                  </td>
                  <td>
                    <span className="member-badge">{m.levelName ?? 'Membro'}</span>
                  </td>
                  <td>{m.channelName}</td>
                  <td>{m.memberSince ? new Date(m.memberSince).toLocaleDateString('pt-BR') : '—'}</td>
                  <td>
                    <AnimatedNumber value={m.months} format={num} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!value?.items.length && (
          <div className="empty" role="status">
            {loading
              ? 'Consultando membros…'
              : value?.status === 'available'
                ? 'Nenhum membro encontrado.'
                : 'A lista de membros não está disponível nesta conexão.'}
          </div>
        )}
        <div className="studio-pagination">
          <span>{value?.pagination.total ?? '—'} membros</span>
          <button disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>
            Anterior
          </button>
          <button
            disabled={!value || page >= value.pagination.totalPages || loading}
            onClick={() => setPage(p => p + 1)}
          >
            Próxima
          </button>
        </div>
      </section>
    </div>
  );
}
