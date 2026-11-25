import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

const duration = 1400;
// Dashboard animations were explicitly requested. Keep a separate, reversible
// preference instead of silently disabling them based on the OS setting.
const motionKey = 'serial-data-motion';
/** The app's own animation preference (on by default; the OS reduced-motion setting is not used). */
export const motionEnabled = () => {
  try {
    return localStorage.getItem(motionKey) !== 'off';
  } catch {
    return true;
  }
};
/** Mirrors the preference on <html data-motion="off">, which the CSS uses instead of the OS reduced-motion setting. */
function applyMotionAttribute() {
  if (motionEnabled()) delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = 'off';
}
applyMotionAttribute();
addEventListener('serial-motion-change', applyMotionAttribute);
addEventListener('storage', applyMotionAttribute);
const subscribe = (notify: () => void) => {
  addEventListener('serial-motion-change', notify);
  addEventListener('storage', notify);
  return () => {
    removeEventListener('serial-motion-change', notify);
    removeEventListener('storage', notify);
  };
};
export function MotionToggle() {
  const on = useSyncExternalStore(subscribe, motionEnabled);
  return (
    <button
      className="icon"
      aria-label={on ? 'Desativar animações' : 'Ativar animações'}
      title={on ? 'Animações ativadas' : 'Animações desativadas'}
      aria-pressed={on}
      onClick={() => {
        try {
          localStorage.setItem(motionKey, on ? 'off' : 'on');
        } catch {}
        dispatchEvent(new Event('serial-motion-change'));
      }}
    >
      <span aria-hidden="true">{on ? '▶' : '⏸'}</span>
    </button>
  );
}
const reduced = () => !motionEnabled();
const MotionContext = createContext({ active: true, cycle: 0, viewKey: '', motion: true });
export function AnimatedNumber({
  value,
  format = String,
}: {
  value: number | null | undefined;
  format?: (n: number) => string;
}) {
  const { active, cycle, viewKey, motion } = useContext(MotionContext);
  const [shown, setShown] = useState(() => (reduced() || !motion || value == null ? (value ?? 0) : 0));
  useEffect(() => {
    if (!active || value == null || !Number.isFinite(value)) {
      if (value == null) setShown(0);
      return;
    }
    if (reduced() || !motion) {
      setShown(value);
      return;
    }
    const start = Number.isFinite(shown) ? shown : 0;
    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / duration);
      setShown(start + (value - start) * progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, active, cycle, viewKey, motion]);
  return (
    <span className="animated-number" aria-label={value == null ? '—' : format(value)}>
      <span className="number-width" aria-hidden="true">
        {value == null ? '—' : format(value)}
      </span>
      <span aria-hidden="true">{value == null ? '—' : format(Number(shown))}</span>
    </span>
  );
}

export function DataMotion({
  active,
  viewKey = '',
  children,
}: {
  active: boolean;
  viewKey?: string;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false),
    [cycle, setCycle] = useState(0),
    motion = useSyncExternalStore(subscribe, motionEnabled);
  useEffect(() => {
    if (!active) {
      setReady(false);
      return;
    }
    if (reduced() || !motion) {
      setReady(true);
      return;
    }
    let frame = 0;
    frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [active, viewKey, motion]);
  return (
    <MotionContext.Provider value={{ active, cycle, viewKey, motion }}>
      <div
        className={'data-motion' + (ready ? ' ready' : '')}
        onClickCapture={event => {
          const button = (event.target as Element).closest('button');
          if (button?.closest('.tabs,.engagement-metrics') && !button.matches('.selected,[aria-pressed="true"]'))
            setCycle(v => v + 1);
        }}
      >
        {children}
      </div>
    </MotionContext.Provider>
  );
}
