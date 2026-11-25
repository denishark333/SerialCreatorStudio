import { useEffect, useId, useMemo, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { durationSeconds, nearestPoint, retentionPoints, timeLabel } from './retention';
export function RetentionChart({
  rows,
  duration,
  reason,
}: {
  rows: Record<string, unknown>[];
  duration?: string;
  reason?: string | null;
}) {
  const points = useMemo(() => retentionPoints(rows), [rows]),
    [index, setIndex] = useState(0),
    gradient = useId().replace(/:/g, ''),
    seconds = durationSeconds(duration);
  useEffect(() => setIndex(nearestPoint(points, 0.5)), [points]);
  if (!points.length)
    return (
      <div className="retention-unavailable">
        <strong>Retenção do vídeo</strong>
        <p>{reason || 'A retenção ainda não está disponível para este vídeo no período selecionado.'}</p>
      </div>
    );
  const active = points[Math.min(index, points.length - 1)],
    maximum = Math.max(1, ...points.map(p => p.audienceWatchRatio)) * 1.08;
  const y = (value: number) => 128 - (value / maximum) * 114;
  const line = points
    .map((p, i) => `${i ? 'L' : 'M'}${p.elapsedVideoTimeRatio * 1000},${y(p.audienceWatchRatio)}`)
    .join(' ');
  const area =
    line + ` L${points.at(-1)!.elapsedVideoTimeRatio * 1000},140 L${points[0].elapsedVideoTimeRatio * 1000},140 Z`;
  const label = (ratio: number) => (seconds ? timeLabel(seconds * ratio) : Math.round(ratio * 100) + '% do vídeo');
  const percentage =
    new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(active.audienceWatchRatio * 100) + '%';
  function pointer(e: PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    setIndex(nearestPoint(points, Math.max(0, Math.min(1, (e.clientX - box.left) / box.width))));
  }
  function keyboard(e: KeyboardEvent<HTMLDivElement>) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      setIndex(i =>
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? points.length - 1
            : Math.max(0, Math.min(points.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1))),
      );
    }
  }
  return (
    <div className="interactive-retention">
      <div className="retention-caption">
        <strong data-testid="retention-value">{percentage}</strong>
        <span>
          de retenção em <b data-testid="retention-time">{label(active.elapsedVideoTimeRatio)}</b>
        </span>
        <small>Retenção de audiência</small>
      </div>
      <div
        className="retention-surface"
        role="slider"
        tabIndex={0}
        aria-label="Explorar retenção do vídeo"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(active.elapsedVideoTimeRatio * 100)}
        aria-valuetext={`${percentage} de retenção em ${label(active.elapsedVideoTimeRatio)}`}
        onPointerMove={pointer}
        onPointerDown={pointer}
        onKeyDown={keyboard}
      >
        <svg viewBox="0 0 1000 140" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity=".28" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map(value => (
            <line
              key={value}
              x1="0"
              x2="1000"
              y1={y(maximum * value)}
              y2={y(maximum * value)}
              stroke="currentColor"
              strokeOpacity=".18"
              strokeDasharray="3 7"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <g className="retention-drawing">
            <path d={area} fill={`url(#${gradient})`} />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          </g>
          <line
            x1={active.elapsedVideoTimeRatio * 1000}
            x2={active.elapsedVideoTimeRatio * 1000}
            y1="0"
            y2="140"
            stroke="white"
            strokeOpacity=".35"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="retention-active-dot"
          style={{
            left: active.elapsedVideoTimeRatio * 100 + '%',
            top: (y(active.audienceWatchRatio) / 140) * 100 + '%',
          }}
        />
      </div>
      <div className="retention-time-axis">
        <span>{seconds ? '0:00' : '0%'}</span>
        <span>{label(0.5)}</span>
        <span>{seconds ? timeLabel(seconds) : '100%'}</span>
      </div>
      {active.audienceWatchRatio > 1 && (
        <small className="retention-repeat-note">Repetições de trechos podem elevar a retenção acima de 100%.</small>
      )}
    </div>
  );
}
