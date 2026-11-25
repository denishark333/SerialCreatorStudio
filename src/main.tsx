import { DataMotion, MotionToggle } from './DataMotion';
import { clearDataCache } from './dataCache';
import { PlatformPicker } from './PlatformPicker';
import { PlatformProvider, PlatformScope, usePlatform } from './PlatformContext';
import { PlatformIcon } from './PlatformIcon';
import { brandIcon } from './brand';
import { apiBase } from './apiConfig';
import { Login } from './Login';
import { apiSession, endSession, refreshSession, restoreSession } from './apiSession';
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarDays,
  ChevronRight,
  Clapperboard,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
  Wallet,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { GlobalSync } from './GlobalSync';
// The signed-in screens (and the chart library they use) load after login: the login page stays light.
const StudioCatalog = lazy(() => import('./StudioCatalog').then(m => ({ default: m.StudioCatalog })));
const LiveWorkspace = lazy(() => import('./LiveWorkspace').then(m => ({ default: m.LiveWorkspace })));
const Connections = lazy(() => import('./Connections').then(m => ({ default: m.Connections })));
const PageLoading = () => (
  <p className="api-note" role="status">
    Carregando…
  </p>
);
import { channels as loadChannels } from './studioApi';
import type { ApiChannel, Platform } from './api';
import './style.css';
import './studio-theme.css';
const navigation = [
  { id: 'home', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'content', label: 'Conteúdo', icon: Clapperboard },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'planner', label: 'Planejamento', icon: CalendarDays },
  { id: 'revenue', label: 'Receitas', icon: Wallet },
  { id: 'community', label: 'Comunidade', icon: Users },
];
function PlatformPages({ route, query }: { route: string; query: string }) {
  const { platform } = usePlatform(),
    visited = useRef(new Map<Platform, { route: string; query: string }>());
  useEffect(() => {
    dispatchEvent(new CustomEvent('serial-data-updated', { detail: { cacheRefresh: true } }));
  }, [platform]);
  visited.current.set(platform, { route, query });
  return (
    <>
      {Array.from(visited.current, ([p, view]) => (
        <div className="platform-page" hidden={p !== platform} key={p}>
          <PlatformScope platform={p}>
            <DataMotion active={p === platform} viewKey={view.route}>
              <PlatformPage route={view.route} query={view.query} />
            </DataMotion>
          </PlatformScope>
        </div>
      ))}
    </>
  );
}
function PlatformPage({ route, query }: { route: string; query: string }) {
  return (
    <Suspense fallback={<PageLoading />}>
      {route === 'settings' ? (
        <Connections />
      ) : route === 'content' ? (
        <StudioCatalog search={query} />
      ) : navigation.some(n => n.id === route) ? (
        <LiveWorkspace route={route} />
      ) : (
        <section className="panel empty">
          <h2>Página não encontrada</h2>
          <a href="#/home" className="text-link">
            Voltar ao estúdio <ArrowRight size={14} />
          </a>
        </section>
      )}
    </Suspense>
  );
}
function Studio({ onLogout }: { onLogout: () => void }) {
  const { platform, setPlatform, channels, error: platformError, saving: preferenceSaving } = usePlatform();
  const [collapsed, setCollapsed] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput.current?.focus();
      }
    };
    addEventListener('keydown', shortcut);
    return () => removeEventListener('keydown', shortcut);
  }, []);
  const [route, setRoute] = useState(() => location.hash.slice(2).split('?')[0] || 'home'),
    [mobile, setMobile] = useState(false),
    [query, setQuery] = useState(''),
    [theme, setTheme] = useState(() =>
      (() => {
        try {
          return JSON.parse(localStorage.getItem('serial-theme') ?? '"dark"');
        } catch {
          return 'dark';
        }
      })(),
    );
  useEffect(() => {
    const f = () => {
      setRoute(location.hash.slice(2).split('?')[0] || 'home');
      setMobile(false);
    };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('serial-theme', JSON.stringify(theme));
    } catch {
      // Storage unavailable (private mode, quota, policy): the theme still applies for this session.
    }
  }, [theme]);

  const primary = channels.find(c => c.id === apiSession.primaryChannelId) ?? channels[0];
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => setAvatarFailed(false), [primary?.thumbnailUrl]);
  const title = navigation.find(n => n.id === route)?.label ?? 'Conexões';
  return (
    <div className={'app' + (collapsed ? ' sidebar-collapsed' : '')}>
      <aside className={'sidebar' + (mobile ? ' open' : '')}>
        <div className="sidebar-brand">
          <a href="#/home" className="brand">
            <img className="brand-logo" src={brandIcon} alt="Serial Healer" width={42} height={42} />
            <div>
              Serial<span>CREATOR STUDIO</span>
            </div>
          </a>
          <button
            className="sidebar-toggle icon"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            onClick={() => setCollapsed(v => !v)}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        <PlatformPicker />
        <p className="nav-label">ESTÚDIO</p>
        <nav>
          {navigation.map((n, i) => (
            <React.Fragment key={n.id}>
              {i === 4 && <p className="nav-label">GESTÃO</p>}
              <a title={n.label} href={'#/' + n.id} className={route === n.id ? 'active' : ''}>
                <n.icon size={18} />
                <span>{n.label}</span>
              </a>
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a href="#/settings" className={route === 'settings' ? 'active' : ''}>
            <Settings size={18} />
            <span>Conexões</span>
          </a>
          <div className="profile">
            <div className="avatar">
              {primary?.thumbnailUrl && !avatarFailed ? (
                <img src={primary.thumbnailUrl} alt="" width={34} height={34} onError={() => setAvatarFailed(true)} />
              ) : (
                (primary?.name.slice(0, 2).toUpperCase() ?? 'S')
              )}
            </div>
            <div className="profile-details">
              <strong>{primary?.name ?? 'Seu estúdio'}</strong>
              <small>Workspace</small>
            </div>
            <button className="logout-button profile-logout" aria-label="Sair da conta" title="Sair" onClick={onLogout}>
              <LogOut size={15} />
              <span>Sair</span>
            </button>
          </div>
        </div>
      </aside>
      {mobile && <div className="scrim" onClick={() => setMobile(false)} />}
      <main>
        <header className="topbar">
          <div className="breadcrumbs">
            <button className="icon mobile-menu" aria-label="Abrir menu" onClick={() => setMobile(!mobile)}>
              <Menu size={20} />
            </button>
            <span className="breadcrumb-platform">
              <PlatformIcon platform={platform} size={14} />
              {platform}
            </span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="top-actions">
            <label className="global-search">
              <Search size={15} />
              <input
                ref={searchInput}
                aria-label="Buscar conteúdo global"
                placeholder="Buscar conteúdo…"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  location.hash = '/content';
                }}
              />
              <kbd>Ctrl K</kbd>
            </label>
            <GlobalSync compact />
            <MotionToggle />
            <button
              className="icon"
              aria-label="Alternar tema"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <Sun size={18} />
            </button>
            <a className="primary" href="#/planner">
              <Plus size={16} />
              Criar conteúdo
            </a>
            <button className="logout-button" onClick={onLogout}>
              Sair
            </button>
          </div>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
            </div>
          </div>
          {platformError && (
            <p className="api-error" role="alert">
              {platformError}
            </p>
          )}
          <PlatformPages route={route} query={query} />
          <footer className="page-footer">
            <a href="/privacidade/" target="_blank" rel="noopener noreferrer">
              Privacidade
            </a>
            <a href="/termos/" target="_blank" rel="noopener noreferrer">
              Termos
            </a>
            <span>
              <Activity size={13} />
              Serial Creator Studio
            </span>
            <span>Dados das plataformas conectadas · v{__APP_VERSION__}</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
function App() {
  // A platform session saved in this tab survives reloads (F5); an expired or revoked one ends on the first 401.
  const [authenticated, setAuthenticated] = useState(() => restoreSession()),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const end = (event: Event) => {
      setNotice((event as CustomEvent).detail?.message ?? 'Sua sessão foi encerrada. Entre novamente.');
      clearDataCache();
      endSession();
      setAuthenticated(false);
    };
    addEventListener('serial-session-ended', end);
    return () => removeEventListener('serial-session-ended', end);
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    // Someone using the dashboard is not signed out mid-task: with less than 1 h left and activity in the last
    // 30 min, the session token is renewed silently. An idle tab still expires.
    let lastActivity = Date.now(),
      renewing = false,
      retryAt = 0;
    const active = () => {
      lastActivity = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach(name => addEventListener(name, active, { passive: true }));
    const timer = setInterval(() => {
      const left = apiSession.expiresAt - Date.now();
      if (apiSession.expiresAt && left <= 0) {
        clearDataCache();
        endSession();
        setAuthenticated(false);
        return;
      }
      if (
        apiSession.expiresAt &&
        left < 3600000 &&
        Date.now() - lastActivity < 1800000 &&
        !renewing &&
        Date.now() >= retryAt
      ) {
        renewing = true;
        void refreshSession(apiBase)
          .then(ok => {
            if (!ok) retryAt = Date.now() + 300000;
          })
          .finally(() => {
            renewing = false;
          });
      }
    }, 10000);
    return () => {
      clearInterval(timer);
      events.forEach(name => removeEventListener(name, active));
    };
  }, [authenticated]);
  return authenticated ? (
    <PlatformProvider>
      <Studio
        onLogout={() => {
          void fetch(apiBase + '/api/v1/auth/logout', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + apiSession.token },
          }).catch(() => {});
          clearDataCache();
          endSession();
          setAuthenticated(false);
        }}
      />
    </PlatformProvider>
  ) : (
    <Login
      notice={notice}
      onLogin={() => {
        setNotice('');
        setAuthenticated(true);
      }}
    />
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Installable app (PWA): the service worker only exists in the production build, served over HTTPS.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:')
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
