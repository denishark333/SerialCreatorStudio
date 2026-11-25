export type RetentionPoint = { elapsedVideoTimeRatio: number; audienceWatchRatio: number };
export function durationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  if (/^\d+(?::\d{1,2}){1,2}$/.test(value)) {
    const parts = value.split(':').map(Number);
    if (parts.slice(1).some(part => part >= 60)) return null;
    return parts.reduce((seconds, part) => seconds * 60 + part, 0) || null;
  }
  const iso = value.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso)
    return (
      Number(iso[1] ?? 0) * 86400 + Number(iso[2] ?? 0) * 3600 + Number(iso[3] ?? 0) * 60 + Number(iso[4] ?? 0) || null
    );
  const units = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
  return units ? Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0) || null : null;
}
export function timeLabel(seconds: number) {
  const total = Math.max(0, Math.round(seconds)),
    hours = Math.floor(total / 3600),
    minutes = Math.floor((total % 3600) / 60),
    rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
export function retentionPoints(rows: Record<string, unknown>[]) {
  return rows
    .filter(
      row =>
        row.elapsedVideoTimeRatio != null &&
        row.audienceWatchRatio != null &&
        row.elapsedVideoTimeRatio !== '' &&
        row.audienceWatchRatio !== '',
    )
    .map(row => ({
      elapsedVideoTimeRatio: Number(row.elapsedVideoTimeRatio),
      audienceWatchRatio: Number(row.audienceWatchRatio),
    }))
    .filter(
      p =>
        Number.isFinite(p.elapsedVideoTimeRatio) &&
        p.elapsedVideoTimeRatio >= 0 &&
        p.elapsedVideoTimeRatio <= 1 &&
        Number.isFinite(p.audienceWatchRatio) &&
        p.audienceWatchRatio >= 0,
    )
    .sort((a, b) => a.elapsedVideoTimeRatio - b.elapsedVideoTimeRatio);
}

export function nearestPoint(points: RetentionPoint[], ratio: number) {
  return points.reduce(
    (best, point, i) =>
      Math.abs(point.elapsedVideoTimeRatio - ratio) < Math.abs(points[best].elapsedVideoTimeRatio - ratio) ? i : best,
    0,
  );
}
