import { useEffect, useState } from 'react';
import type { Platform } from '../api';
import { studioRequest } from '../studioApi';
import { SubscriberGoal } from './SubscriberGoal';

const storageKey = (platform: Platform) => 'serial-goal-metric-' + platform;

/**
 * Goal card of a live-streaming platform (Twitch, Kick): followers or paid subscribers, each with its own target.
 * The chosen metric is remembered per platform in this browser; by default, the first one the platform provides.
 */
export function StreamGoal({
  platform,
  followers,
  subscribers,
  onError,
}: {
  platform: Platform;
  followers: number | null;
  subscribers: number | null;
  onError: (message: string) => void;
}) {
  const prefix = platform.toLowerCase();
  const metrics = [
    { key: prefix + '.followers', label: 'Seguidores', unit: 'seguidores', value: followers },
    { key: prefix + '.subscribers', label: 'Assinantes', unit: 'assinantes', value: subscribers },
  ];
  const [metric, setMetric] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey(platform));
      if (saved && metrics.some(m => m.key === saved)) return saved;
    } catch {
      // Storage unavailable: use the default.
    }
    return (metrics.find(m => m.value !== null) ?? metrics[0]).key;
  });
  const [goal, setGoal] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    setGoal(null);
    studioRequest<{ target: number | null }>('subscriber-goal', { params: { metric } })
      .then(r => active && setGoal(r.target))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [metric]);
  function choose(key: string) {
    setMetric(key);
    try {
      localStorage.setItem(storageKey(platform), key);
    } catch {
      // Only a convenience.
    }
  }
  const current = metrics.find(m => m.key === metric) ?? metrics[0];
  return (
    <SubscriberGoal
      key={metric}
      goal={goal}
      subscribers={current.value}
      metric={metric}
      unit={current.unit}
      subtitle={`Canais da ${platform} selecionados`}
      unavailable={`A API da ${platform} não informa o total de ${current.unit}. Escolha outra métrica.`}
      onSaved={setGoal}
      onError={onError}
    >
      <div className="segmented goal-metric" role="group" aria-label="Métrica da meta">
        {metrics.map(m => (
          <button
            type="button"
            key={m.key}
            className={m.key === metric ? 'selected' : ''}
            aria-pressed={m.key === metric}
            onClick={() => choose(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </SubscriberGoal>
  );
}
