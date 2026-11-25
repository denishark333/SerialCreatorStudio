import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiBase, channels as loadChannels } from './studioApi';
import { apiSession } from './apiSession';
import type { ApiChannel, Platform } from './api';
const platforms: Platform[] = ['YouTube', 'Twitch', 'Kick'];
type State = {
  platform: Platform;
  setPlatform: (platform: Platform) => void;
  channels: ApiChannel[];
  error: string;
  preferenceNotice: string;
  saving: boolean;
};
const Context = createContext<State | null>(null);
const valid = (value: unknown): value is Platform => platforms.includes(value as Platform);
export function PlatformProvider({ children }: { children: ReactNode }) {
  const workspace = apiSession.workspaceId,
    key = 'serial-platform:' + workspace;
  const cached = () => {
    try {
      const value = localStorage.getItem(key);
      return valid(value) ? value : null;
    } catch {
      return null;
    }
  };
  const [platform, setValue] = useState<Platform>(() => cached() ?? 'YouTube'),
    [channels, setChannels] = useState<ApiChannel[]>([]),
    [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [preferenceNotice, setPreferenceNotice] = useState('');
  const serverSupported = useRef(true);
  const queue = useRef<Promise<void>>(Promise.resolve()),
    version = useRef(0),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    let current = true;
    async function initialize() {
      try {
        const results = await Promise.allSettled([
          loadChannels(),
          fetch(apiBase + '/api/v1/workspaces/' + workspace + '/preferences', {
            headers: { Authorization: 'Bearer ' + apiSession.token },
            signal: AbortSignal.timeout(15000),
          }).then(async response => {
            if ([404, 405, 501].includes(response.status)) {
              serverSupported.current = false;
              setPreferenceNotice(
                'Preferência salva neste dispositivo. Atualize a API da VPS para salvar entre sessões e dispositivos.',
              );
              return null;
            }
            if (!response.ok) return null;
            return (await response.json()).data?.platform;
          }),
        ]);
        if (!current) return;
        const rows = results[0].status === 'fulfilled' ? results[0].value : [];
        setChannels(rows);
        const saved = results[1].status === 'fulfilled' ? results[1].value : null;
        const preferred = valid(saved)
          ? saved
          : (cached() ?? rows.find(c => c.id === apiSession.primaryChannelId)?.platform ?? 'YouTube');
        setValue(preferred);
        try {
          localStorage.setItem(key, preferred);
        } catch {}
        if (results[0].status === 'rejected') setError('Não foi possível carregar seus canais.');
      } finally {
        if (current) setReady(true);
      }
    }
    void initialize();
    const refresh = () =>
      void loadChannels()
        .then(rows => {
          if (current) setChannels(rows);
        })
        .catch(() => {});
    addEventListener('serial-data-updated', refresh);
    return () => {
      current = false;
      active.current = false;
      removeEventListener('serial-data-updated', refresh);
    };
  }, [workspace]);
  function setPlatform(value: Platform) {
    if (!valid(value)) return;
    const change = ++version.current;
    setValue(value);
    setSaving(true);
    setPreferenceNotice('');
    try {
      localStorage.setItem(key, value);
    } catch {}
    if (!serverSupported.current) {
      setSaving(false);
      setPreferenceNotice(
        'Preferência salva neste dispositivo. Atualize a API da VPS para salvar entre sessões e dispositivos.',
      );
      return;
    }
    const token = apiSession.token;
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          const response = await fetch(apiBase + '/api/v1/workspaces/' + workspace + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ platform: value }),
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) {
            if ([404, 405, 501].includes(response.status)) serverSupported.current = false;
            throw new Error(String(response.status));
          }
          if (active.current && version.current === change) setPreferenceNotice('');
        } catch (e) {
          if (active.current && version.current === change)
            setPreferenceNotice(
              !serverSupported.current
                ? 'Preferência salva neste dispositivo. Atualize a API da VPS para salvar entre sessões e dispositivos.'
                : (e as Error).message === '403'
                  ? 'Preferência salva neste dispositivo. O servidor recusou a gravação (403). Verifique a sessão ou as regras de acesso.'
                  : 'Preferência salva neste dispositivo. O servidor está indisponível para salvar a escolha agora.',
            );
        } finally {
          if (active.current && version.current === change) setSaving(false);
        }
      });
  }
  return (
    <Context.Provider value={{ platform, setPlatform, channels, error, preferenceNotice, saving }}>
      {ready ? (
        children
      ) : (
        <div className="platform-preferences-loading" role="status">
          Carregando seu estúdio…
        </div>
      )}
    </Context.Provider>
  );
}
export function usePlatform() {
  const value = useContext(Context);
  if (!value) throw new Error('PlatformProvider is required');
  return value;
}
export function PlatformScope({ platform, children }: { platform: Platform; children: ReactNode }) {
  const state = usePlatform();
  return <Context.Provider value={{ ...state, platform }}>{children}</Context.Provider>;
}
