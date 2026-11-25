import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  grid,
  monthStart,
  nextStage,
  previousStage,
  stageForFormat,
  stageLabel,
  stageProgress,
  weekdayAudience,
} from '../src/planner/calendar.ts';

test('month grid: 42 days starting on Monday, covering the whole month', () => {
  const days = grid('2026-11-01'); // 1 Nov 2026 is a Sunday
  assert.equal(days.length, 42);
  assert.equal(days[0], '2026-10-26'); // Monday before
  assert.ok(days.includes('2026-11-30'));
  assert.equal(grid('2026-06-01')[0], '2026-06-01'); // month starting on Monday
});

test('month navigation crosses years and never skips short months', () => {
  assert.equal(addMonths('2026-12-01', 1), '2027-01-01');
  assert.equal(addMonths('2026-01-01', -1), '2025-12-01');
  assert.equal(addMonths(monthStart('2026-01-31'), 1), '2026-02-01');
});

test('stage flows: a live skips recording and editing; VODs and clips only need editing', () => {
  assert.equal(nextStage('Roteiro', 'Vídeo'), 'Gravação');
  assert.equal(nextStage('Roteiro', 'Live'), 'Pronto');
  assert.equal(nextStage('Ideia', 'Clip'), 'Edição');
  assert.equal(nextStage('Pronto', 'Live'), null, 'ready: the next step is publishing');
  assert.equal(previousStage('Pronto', 'Live'), 'Roteiro');
  assert.equal(previousStage('Publicado', 'Live'), 'Pronto');
  assert.equal(stageProgress('Pronto', 'Live'), 3);
  assert.equal(stageProgress('Publicado', 'Vídeo'), 5);
  assert.equal(stageForFormat('Edição', 'Live'), 'Roteiro');
  assert.equal(stageForFormat('Gravação', 'VOD'), 'Ideia');
  assert.equal(stageForFormat('Publicado', 'Live'), 'Publicado');
  assert.equal(stageLabel('Publicado', 'Live'), 'Realizada');
  assert.equal(stageLabel('Publicado', 'Short'), 'Publicado');
  assert.equal(stageLabel('Roteiro', 'Live'), 'Pauta');
  assert.equal(stageLabel('Roteiro', 'Vídeo'), 'Roteiro');
});

test('weekday audience: needs 4 weeks of data and scales averages to 0..1 (Monday first)', () => {
  const rows = Array.from({ length: 28 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 10, 2 + i)); // 2 Nov 2026 is a Monday
    return { date: day.toISOString().slice(0, 10), views: i % 7 === 4 ? 500 : 100 }; // Fridays peak
  });
  const audience = weekdayAudience(rows);
  assert.equal(audience[4], 1);
  assert.equal(audience[0], 0);
  assert.equal(weekdayAudience(rows.slice(0, 20)), null);
});
