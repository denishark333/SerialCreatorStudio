import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createServer as probeServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewFixtures } from './preview-fixtures.mjs';
const probe = probeServer();
await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise(r => probe.close(r));
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true } });
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${port}`,
    fixture = previewFixtures(origin);
  browser = await chromium.launch();
  // reducedMotion: like Windows with animation effects off; the app follows its own preference instead.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/v1/')) {
      const payload = fixture(url.pathname, url.searchParams);
      if (url.pathname.endsWith('/channels')) payload.data.forEach(c => (c.subscribers = 29));
      if (url.pathname.endsWith('/subscriber-goal')) payload.data.target = 1000;
      return route.fulfill({ json: payload });
    }
    if (url.hostname === 'preview.invalid') return route.fulfill({ body: 'Preview authentication' });
    return url.origin === origin ? route.continue() : route.abort();
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  const video = page.locator('video');
  // The login preview starts by itself (autoplay), even with the OS reduced-motion setting.
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && !v.paused && v.currentTime > 0.2;
  });
  await page.getByRole('button', { name: 'Pausar prévia' }).waitFor();
  await video.evaluate(async v => {
    await new Promise(r => (v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, { once: true })));
    v.pause();
  });
  assert.equal(await video.evaluate(v => v.duration), 20);
  for (const [time, name] of [
    [0.1, 'start'],
    [2.4, 'expanded'],
    [6.2, 'shorts'],
    [11.6, 'engagement'],
    [14.6, 'pipeline'],
    [19.98, 'end'],
  ]) {
    await video.evaluate(async (v, time) => {
      v.currentTime = time;
      await new Promise(r => v.addEventListener('seeked', r, { once: true }));
    }, time);
    await video.screenshot({ path: join(tmpdir(), `serial-preview-${name}.png`) });
  }
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continuar com Google / YouTube' }).click();
  await page.locator('.interactive-retention').waitFor();
  await page.waitForTimeout(1550);
  await page.locator('a[href="#/analytics"]').first().click();
  await page.getByRole('button', { name: 'Engajamento', exact: true }).click();
  await page.locator('.engagement-chart .animated-number').waitFor();
  const metric = page.locator('.engagement-chart .animated-number');
  await page.waitForTimeout(150);
  const mid = await metric.innerText(),
    finalLabel = await metric.getAttribute('aria-label');
  assert.notEqual(mid, finalLabel);
  // The chart itself animates with Recharts' built-in transition (no clip-path reveal); only the count is asserted.
  await page.locator('.engagement-plot .recharts-area').first().waitFor();
  await page.locator('.engagement-chart').screenshot({ path: join(tmpdir(), 'serial-motion-intermediate.png') });
  await page.waitForTimeout(1550);
  assert.equal(await metric.innerText(), finalLabel);
  await page.locator('.engagement-chart').screenshot({ path: join(tmpdir(), 'serial-motion-complete.png') });
  // Reopening a subtab replays presentation without changing the fetched values.
  await page.getByRole('button', { name: 'Alcance', exact: true }).click();
  await page.getByRole('button', { name: 'Engajamento', exact: true }).click();
  await page.waitForTimeout(150);
  assert.notEqual(await metric.innerText(), finalLabel);
  await page.waitForTimeout(1550);
  assert.equal(await metric.innerText(), finalLabel);
  await page.locator('a[href="#/home"]').first().click();
  await page.locator('.big-number .animated-number').waitFor();
  await page.waitForTimeout(1550);
  const views = page.locator('.big-number .animated-number');
  assert.equal(await views.innerText(), await views.getAttribute('aria-label'));
  const goal = page.locator('.goal-ring');
  await goal.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1550);
  assert.equal((await goal.innerText()).replace(/\s/g, ''), '2,9%');
  const layout = await goal.evaluate(el => {
    const label = el.querySelector(':scope>span'),
      number = label.querySelector('.animated-number'),
      a = label.getBoundingClientRect(),
      b = number.getBoundingClientRect();
    return {
      labelHeight: a.height,
      numberHeight: b.height,
      numberWidth: b.width,
      labelWidth: a.width,
      childBackground: getComputedStyle(number.querySelector('span')).backgroundColor,
    };
  });
  assert(layout.numberHeight < layout.labelHeight / 2);
  assert(layout.numberWidth < layout.labelWidth);
  assert.equal(layout.childBackground, 'rgba(0, 0, 0, 0)');
  await goal.screenshot({ path: join(tmpdir(), 'serial-goal-regression.png') });
  await page.locator('a[href="#/analytics"]').first().click();
  await page.getByRole('button', { name: 'Engajamento', exact: true }).click();
  await metric.waitFor();
  // Motion follows the dashboard's own toggle (by design it ignores the OS reduced-motion setting).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Compartilhamentos', exact: true }).click();
  await page.waitForTimeout(80);
  assert.notEqual(await metric.innerText(), await metric.getAttribute('aria-label'), 'OS setting must not stop motion');
  await page.waitForTimeout(1550);
  await page.getByRole('button', { name: 'Desativar animações' }).first().click();
  await page.getByRole('button', { name: 'Curtidas', exact: true }).click();
  await page.waitForTimeout(80);
  assert.equal(await metric.innerText(), await metric.getAttribute('aria-label'));
  assert.equal(await page.locator('.engagement-plot').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  // The app toggle (not the OS) turns CSS transitions off, e.g. the platform carousel slide.
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'off');
  assert.equal(
    await page
      .locator('.platform-carousel-item.current')
      .evaluate(el => getComputedStyle(el).transitionDuration.split(',')[0]),
    '0s',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: preview autoplays (OS reduced-motion on), 20s media, storyboard screenshots, intermediate/final counts, motion toggle (OS reduced-motion ignored by design), no runtime errors.',
  );
} finally {
  await browser?.close();
  await server.close();
}
