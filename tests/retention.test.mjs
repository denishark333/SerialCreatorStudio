import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durationSeconds, timeLabel, retentionPoints, nearestPoint } from '../src/retention.ts';

test('video duration formats map retention positions to actual timestamps', () => {
  assert.equal(durationSeconds('18:24'), 1104);
  assert.equal(durationSeconds('1:02:03'), 3723);
  assert.equal(durationSeconds('PT1H2M3S'), 3723);
  assert.equal(durationSeconds('1h2m3s'), 3723);
  assert.equal(timeLabel(durationSeconds('18:24') * 0.75), '13:48');
  assert.equal(timeLabel(3723), '1:02:03');
  assert.equal(durationSeconds(undefined), null);
  assert.equal(durationSeconds('unknown'), null);
  assert.equal(durationSeconds('1:99'), null);
});

test('missing retention remains absent; valid zero and replay values above 100% are preserved', () => {
  const points = retentionPoints([
    { elapsedVideoTimeRatio: 0.75, audienceWatchRatio: 0.42 },
    { elapsedVideoTimeRatio: null, audienceWatchRatio: null },
    { elapsedVideoTimeRatio: '', audienceWatchRatio: '' },
    { elapsedVideoTimeRatio: 0.25, audienceWatchRatio: 1.2 },
    { elapsedVideoTimeRatio: 1, audienceWatchRatio: 0 },
    { elapsedVideoTimeRatio: 0.5, audienceWatchRatio: NaN },
    { elapsedVideoTimeRatio: 2, audienceWatchRatio: 0.4 },
  ]);
  assert.deepEqual(points, [
    { elapsedVideoTimeRatio: 0.25, audienceWatchRatio: 1.2 },
    { elapsedVideoTimeRatio: 0.75, audienceWatchRatio: 0.42 },
    { elapsedVideoTimeRatio: 1, audienceWatchRatio: 0 },
  ]);
  assert.deepEqual(retentionPoints([]), []);
});

test('hover selects a real sample instead of inventing interpolated measurements', () => {
  const points = retentionPoints([
    { elapsedVideoTimeRatio: 0.25, audienceWatchRatio: 0.8 },
    { elapsedVideoTimeRatio: 0.75, audienceWatchRatio: 0.4 },
  ]);
  assert.equal(nearestPoint(points, 0.2), 0);
  assert.equal(nearestPoint(points, 0.7), 1);
  assert.equal(points[nearestPoint(points, 0.55)].audienceWatchRatio, 0.4);
});
