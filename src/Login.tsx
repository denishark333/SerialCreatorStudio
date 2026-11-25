import { LoginPreview } from './LoginPreview';
import { legalVersion } from './PrivacyPanel';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, ArrowRight, LockKeyhole } from 'lucide-react';
import { brandIcon } from './brand';
import { apiBase } from './apiConfig';
import { startAdminSession, startSession } from './apiSession';
// Enable temporarily when administrative access is needed; never embed the admin key.
const ENABLE_ADMIN_LOGIN = false;

type Flow = { id: string; secret: string; authorizationUrl: string };
export function Login({ onLogin, notice = '' }: { onLogin: () => void; notice?: string }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [token, setToken] = useState(''),
    [inviteRequired, setInviteRequired] = useState(false),
    [invite, setInvite] = useState('');
  const active = useRef(0),
    popup = useRef<Window | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    active.current++;
    if (timer.current) clearTimeout(timer.current);
    popup.current?.close();
    setBusy('');
  };
  useEffect(() => {
    // Closed beta: the API says whether a new studio needs an invite code.
    fetch(apiBase + '/api/v1/auth/options', { signal: AbortSignal.timeout(15000) })
      .then(r => (r.ok ? r.json() : null))
      .then(b => setInviteRequired(Boolean(b?.data?.inviteRequired)))
      .catch(() => {});
  }, []);
  useEffect(
    () => () => {
      active.current++;
      if (timer.current) clearTimeout(timer.current);
      popup.current?.close();
    },
    [],
  );
  async function json(path: string, body?: unknown) {
    const r = await fetch(apiBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15000),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error?.message ?? 'Falha ao iniciar o login.');
    return b.data;
  }
  async function connect(provider: string) {
    if (busy || !accepted) return;
    setError('');
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setError('Permita novas abas para entrar com sua plataforma.');
      return;
    }
    tab.opener = null;
    popup.current = tab;
    setBusy(provider);
    const run = ++active.current,
      expires = Date.now() + 600000;
    try {
      const flow = (await json('/api/v1/auth/login/' + provider, {
        privacyVersion: legalVersion,
        termsVersion: legalVersion,
        ...(invite.trim() ? { inviteCode: invite.trim() } : {}),
      })) as Flow;
      if (active.current !== run) {
        tab.close();
        return;
      }
      tab.location.replace(flow.authorizationUrl);
      const poll = async () => {
        if (active.current !== run) return;
        try {
          if (Date.now() > expires) throw new Error('Login expirado. Tente novamente.');
          const data = await json('/api/v1/auth/login/poll', { id: flow.id, secret: flow.secret });
          if (active.current !== run) return;
          if (data.status === 'connected') {
            startSession({
              token: data.accessToken,
              workspaceId: data.workspaceId,
              primaryChannelId: data.primaryChannelId ?? null,
              expiresAt: Date.now() + data.expiresIn * 1000,
            });
            setBusy('');
            popup.current?.close();
            window.focus();
            onLogin();
            return;
          }
          timer.current = setTimeout(() => void poll(), 1500);
        } catch (e) {
          if (active.current === run) {
            setError((e as Error).message);
            setBusy('');
          }
        }
      };
      void poll();
    } catch (e) {
      if (active.current === run) {
        tab.close();
        setError(e instanceof TypeError ? 'Servidor indisponível. Confira sua conexão.' : (e as Error).message);
        setBusy('');
      }
    }
  }
  async function admin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy('admin');
    try {
      const candidate = token.trim();
      const r = await fetch(apiBase + '/api/v1/workspaces', {
        headers: { Authorization: 'Bearer ' + candidate },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error('Chave inválida ou servidor indisponível.');
      const b = await r.json();
      if (!b.data?.length) throw new Error('Nenhum estúdio disponível.');
      startAdminSession(candidate, b.data.find((w: { id: string }) => w.id === 'studio-live')?.id ?? b.data[0].id);
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="brand">
          <img className="brand-logo" src={brandIcon} alt="Serial Healer" width={42} height={42} />
          <div>
            Serial<span>CREATOR STUDIO</span>
          </div>
        </div>
        <LoginPreview />
      </section>
      <section className="panel login-card">
        <span className="login-lock">
          <LockKeyhole size={24} />
        </span>
        <h2>Entrar na Dashboard</h2>
        <p>Escolha uma conta. Seu canal ser&aacute; conectado ao seu est&uacute;dio automaticamente.</p>
        {notice && (
          <p className="api-message" role="status">
            {notice}
          </p>
        )}
        <label className="legal-consent">
          <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
          <span>
            Li e concordo com os{' '}
            <a href="/termos/" target="_blank" rel="noopener noreferrer">
              Termos de uso
            </a>{' '}
            e a{' '}
            <a href="/privacidade/" target="_blank" rel="noopener noreferrer">
              Política de privacidade
            </a>
            .
          </span>
        </label>
        {inviteRequired && (
          <div className="login-invite">
            <label htmlFor="invite-code">C&oacute;digo de convite</label>
            <div className="login-input">
              <input
                id="invite-code"
                autoComplete="off"
                maxLength={64}
                value={invite}
                onChange={e => setInvite(e.target.value)}
                disabled={!!busy}
                placeholder="Somente para criar um estúdio novo"
              />
            </div>
          </div>
        )}
        <div className="login-providers">
          {[
            ['google', 'Google / YouTube'],
            ['twitch', 'Twitch'],
            ['kick', 'Kick'],
          ].map(([id, name]) => (
            <button
              key={id}
              className={id === 'google' ? 'primary' : ''}
              disabled={!!busy || !accepted}
              onClick={() => void connect(id)}
            >
              Continuar com {name}
              <ArrowRight size={17} />
            </button>
          ))}
        </div>
        {busy && busy !== 'admin' && (
          <div role="status">
            <p>Conclua a autoriza&ccedil;&atilde;o na aba da plataforma. A Dashboard abrir&aacute; automaticamente.</p>
            <button onClick={cancel}>Cancelar</button>
          </div>
        )}
        {error && (
          <p role="alert" className="api-error">
            {error}
          </p>
        )}
        <p className="footnote">
          Cada usu&aacute;rio acessa apenas seu est&uacute;dio. Para reunir mais plataformas, conecte-as depois de
          entrar.
        </p>
        {ENABLE_ADMIN_LOGIN && (
          <details>
            <summary>Acesso administrativo</summary>
            <form onSubmit={e => void admin(e)}>
              <label htmlFor="access-key">Chave do administrador</label>
              <div className="login-input">
                <input
                  id="access-key"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  required
                  disabled={!!busy}
                />
              </div>
              <button className="primary" disabled={!!busy || !token.trim()}>
                Entrar como administrador
              </button>
            </form>
          </details>
        )}
      </section>
    </main>
  );
}
