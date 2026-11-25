import { confirmAction } from './ConfirmDialog';
import { PrivacyPanel } from './PrivacyPanel';
import { usePlatform } from './PlatformContext';
import { PlatformIcon } from './PlatformIcon';
import { useEffect, useRef, useState } from 'react';
import { Link2, RefreshCw, Unplug, ExternalLink } from 'lucide-react';
import { apiSession } from './apiSession';
import { channels as getChannels } from './studioApi';
import type { ApiChannel, Platform } from './api';
import { apiBase as base } from './apiConfig';

type MergeDraft = {
  id: string;
  secret: string;
  sourceChannels: { name: string; platform: Platform }[];
  counts: Record<string, number>;
};
type Status = {
  providers: { platform: Platform; configured: boolean; redirectUri: string }[];
  items: {
    id: string;
    platform: Platform;
    channelIds: string[];
    status: string;
    lastError: string | null;
    permissionsComplete?: boolean;
  }[];
};
async function request<T>(path: string, method = 'GET'): Promise<T> {
  const r = await fetch(base + '/api/v1/workspaces/' + apiSession.workspaceId + '/' + path, {
    method,
    headers: apiSession.token ? { Authorization: 'Bearer ' + apiSession.token } : {},
  });
  if (r.status === 204) return undefined as T;
  const b = await r.json();
  if (!r.ok) throw new Error(b.error?.message ?? 'Falha ao consultar a API');
  return b.data;
}
export function Connections() {
  const { platform, preferenceNotice } = usePlatform();
  const [status, setStatus] = useState<Status | null>(null),
    [channels, setChannels] = useState<ApiChannel[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [mergeDraft, setMergeDraft] = useState<MergeDraft | null>(null);
  const attempt = useRef(0),
    popupRef = useRef<Window | null>(null),
    waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      attempt.current++;
      if (waitTimer.current) clearTimeout(waitTimer.current);
      popupRef.current?.close();
    },
    [],
  );
  const load = async () => {
    try {
      setError('');
      const [s, c] = await Promise.all([request<Status>('connections'), getChannels(platform)]);
      setStatus(s);
      setChannels(c);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
    const refresh = () => void load();
    addEventListener('serial-data-updated', refresh);
    addEventListener('focus', refresh);
    return () => {
      removeEventListener('serial-data-updated', refresh);
      removeEventListener('focus', refresh);
    };
  }, []);
  async function connect(p: Platform) {
    if (busy) return;
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      setError('Permita novas abas para conectar a plataforma.');
      return;
    }
    popup.opener = null;
    popupRef.current = popup;
    const run = ++attempt.current,
      expires = Date.now() + 600000;
    setBusy(true);
    setError('');
    try {
      const flow = await request<{ authorizationUrl: string; id?: string; secret?: string }>(
        'connections/' + p + '/authorize',
        'POST',
      );
      popup.location.replace(flow.authorizationUrl);
      if (!flow.id || !flow.secret) {
        setBusy(false);
        setError('Atualize o backend para concluir a conexão automaticamente.');
        return;
      }
      const poll = async () => {
        if (attempt.current !== run) return;
        try {
          if (Date.now() > expires) throw new Error('A autorização expirou. Tente novamente.');
          const response = await fetch(base + '/api/v1/auth/login/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: flow.id, secret: flow.secret }),
            signal: AbortSignal.timeout(15000),
          });
          const value = await response.json();
          if (!response.ok) throw new Error(value.error?.message ?? 'Falha ao verificar autorização.');
          if (attempt.current !== run) return;
          if (value.data.status === 'merge_required') {
            popup.close();
            window.focus();
            setBusy(false);
            setMergeDraft({
              id: flow.id!,
              secret: flow.secret!,
              sourceChannels: value.data.sourceChannels,
              counts: value.data.counts,
            });
            return;
          }
          if (value.data.status === 'connected') {
            popup.close();
            window.focus();
            setBusy(false);
            await load();
            dispatchEvent(new Event('serial-data-updated'));
            return;
          }
          waitTimer.current = setTimeout(() => void poll(), 1500);
        } catch (e) {
          if (attempt.current === run) {
            setError((e as Error).message);
            setBusy(false);
          }
        }
      };
      void poll();
    } catch (e) {
      popup.close();
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function resolveMerge(confirmMerge: boolean) {
    if (!mergeDraft) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(base + '/api/v1/workspaces/' + apiSession.workspaceId + '/connections/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiSession.token },
        body: JSON.stringify({ id: mergeDraft.id, secret: mergeDraft.secret, confirm: confirmMerge }),
        signal: AbortSignal.timeout(15000),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? 'Não foi possível unir os estúdios.');
      setMergeDraft(null);
      await load();
      dispatchEvent(new Event('serial-data-updated'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect(id: string) {
    const confirmed = await confirmAction({
      title: 'Desconectar este canal?',
      message:
        'Os dados deste canal na Dashboard serão excluídos, incluindo planos e registros financeiros, e as sessões deste estúdio serão encerradas. A revogação será solicitada à plataforma e pode exigir reconectar outros canais Google. Se for a última conexão, o estúdio pessoal também será removido. O conteúdo publicado permanece.',
      confirmLabel: 'Desconectar',
      tone: 'danger',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await request<{ message: string }>('privacy/connections/' + encodeURIComponent(id), 'DELETE');
      dispatchEvent(new CustomEvent('serial-session-ended', { detail: { message: result.message } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const providers =
    status?.providers ??
    (['YouTube', 'Twitch', 'Kick'] as Platform[]).map(platform => ({ platform, configured: false, redirectUri: '' }));
  return (
    <div className="connections-page">
      {preferenceNotice && (
        <p className="api-note" role="status">
          {preferenceNotice}
        </p>
      )}
      {error && (
        <p role="alert" className="api-error">
          {error}
        </p>
      )}
      {mergeDraft && (
        <section className="panel merge-review" aria-labelledby="merge-title">
          <h2 id="merge-title">Unir seus est&uacute;dios?</h2>
          <p>
            Esta conta j&aacute; tem um Workspace separado. Voc&ecirc; confirmou o acesso a ela pela plataforma. Ao
            continuar, todos os canais e dados desse Workspace ser&atilde;o reunidos no Workspace atual.
          </p>
          <ul>
            {mergeDraft.sourceChannels.map((channel, i) => (
              <li key={i}>
                <strong>{channel.name}</strong> &middot; {channel.platform}
              </li>
            ))}
          </ul>
          <div className="merge-counts">
            <span>{mergeDraft.counts.contents ?? 0} conte&uacute;dos</span>
            <span>{mergeDraft.counts.comments ?? 0} coment&aacute;rios</span>
            <span>{mergeDraft.counts.plans ?? 0} planos</span>
            <span>{mergeDraft.counts.financial ?? 0} registros financeiros</span>
          </div>
          <p className="footnote">
            Depois, entrar por qualquer uma das contas abre este mesmo Workspace. Sess&otilde;es antigas do outro
            Workspace ser&atilde;o encerradas.
          </p>
          <div className="merge-actions">
            <button className="primary" disabled={busy} onClick={() => void resolveMerge(true)}>
              Unir neste Workspace
            </button>
            <button disabled={busy} onClick={() => void resolveMerge(false)}>
              Manter separados
            </button>
          </div>
        </section>
      )}
      <div className="connector-grid">
        {providers
          .filter(p => p.platform === platform)
          .map(p => {
            const accounts = status?.items.filter(c => c.platform === p.platform) ?? [];
            return (
              <section className="panel connection-card" key={p.platform} aria-busy={!status}>
                <header>
                  <span className={'provider-mark ' + p.platform.toLowerCase()}>
                    <PlatformIcon platform={p.platform} size={23} />
                  </span>
                  <div>
                    <h2>{p.platform}</h2>
                    <span className="muted">
                      {!status
                        ? 'Carregando...'
                        : accounts.length
                          ? accounts.length + ' ' + (accounts.length === 1 ? 'conta conectada' : 'contas conectadas')
                          : 'Sem contas conectadas'}
                    </span>
                  </div>
                </header>
                <div className="connection-accounts">
                  {accounts.map(c => (
                    <div key={c.id} className="connected-account">
                      {channels
                        .filter(ch => c.channelIds.includes(ch.id))
                        .map(ch => (
                          <div className="connection-person" key={ch.id}>
                            <div className="avatar">
                              {ch.thumbnailUrl ? (
                                <img
                                  src={ch.thumbnailUrl}
                                  alt=""
                                  width={38}
                                  height={38}
                                  onError={e => {
                                    e.currentTarget.hidden = true;
                                  }}
                                />
                              ) : (
                                ch.name.slice(0, 2).toUpperCase()
                              )}
                            </div>
                            <div>
                              <strong>{ch.name}</strong>
                              <small>
                                {c.status === 'connected'
                                  ? 'Conectado'
                                  : c.status === 'reauthorization_required'
                                    ? 'Reconectar conta'
                                    : c.status}
                              </small>
                            </div>
                          </div>
                        ))}
                      {c.lastError && <p className="api-error">{c.lastError}</p>}
                      <div className="connection-account-actions">
                        {(c.permissionsComplete === false || c.status === 'reauthorization_required') && (
                          <button disabled={busy} onClick={() => void connect(p.platform)}>
                            Reconectar
                          </button>
                        )}
                        <button disabled={busy} onClick={() => void disconnect(c.id)}>
                          <Unplug size={14} />
                          Desconectar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  className="primary"
                  disabled={!p.configured || busy || !!mergeDraft}
                  onClick={() => void connect(p.platform)}
                >
                  <Link2 size={15} />
                  {accounts.length ? 'Adicionar canal' : 'Conectar ' + p.platform}
                </button>
                {status && !p.configured && (
                  <small className="muted">Integra&ccedil;&atilde;o indispon&iacute;vel no momento.</small>
                )}
              </section>
            );
          })}
      </div>
      <PrivacyPanel />
    </div>
  );
}
