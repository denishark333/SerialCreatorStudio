// End-to-end smoke test of the production bundle against preview fixtures (no real API):
// - the Content-Security-Policy is present and nothing violates it;
// - sign-in works, every tab renders without runtime errors;
// - a reload (F5) keeps the platform session; after logout, a reload shows the login screen.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { build, preview } from 'vite';
import { previewFixtures } from './preview-fixtures.mjs';

const outDir = mkdtempSync(join(tmpdir(), 'serial-csp-'));
let server, browser;
try {
  await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  assert.match(html, /http-equiv="Content-Security-Policy"/, 'CSP meta tag missing from build');

  server = await preview({ logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  const fixture = previewFixtures(origin);
  browser = await chromium.launch();
  // reducedMotion: like Windows with animation effects off; the app follows its own animation preference instead.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/v1/')) return route.fulfill({ json: fixture(url.pathname, url.searchParams) });
    if (url.hostname === 'preview.invalid') return route.fulfill({ body: 'Preview authentication' });
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.origin === origin) return route.continue();
    // Remote thumbnails: answer locally so the check stays offline (CSP is evaluated before the request).
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  });
  await context.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', e =>
      window.__cspViolations.push(`${e.violatedDirective} -> ${e.blockedURI || 'inline'}`),
    );
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => {
    errors.push('native browser dialog: ' + d.message());
    void d.dismiss();
  });
  page.on('console', m => m.text().includes('Content Security Policy') && errors.push(m.text()));

  await page.goto(origin);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continuar com Google / YouTube' }).click();
  await page.locator('.interactive-retention').waitFor();
  // Platform carousel: arrows, keyboard and side icons switch the platform; collapsed sidebar shows only the active one.
  const carousel = page.getByRole('radiogroup', { name: 'Plataforma' });
  const active = () => carousel.getByRole('radio', { checked: true }).getAttribute('aria-label');
  const start = await active();
  const slide = await page
    .locator('.platform-carousel-item.current')
    .evaluate(el => getComputedStyle(el).transitionDuration);
  assert.notEqual(slide.split(',')[0].trim(), '0s', 'carousel slide disabled by the OS reduced-motion setting');
  if (process.env.SHOT_PICKER) await page.locator('.sidebar').screenshot({ path: process.env.SHOT_PICKER + '-1.png' });
  await page.getByRole('button', { name: 'Próxima plataforma' }).click();
  const second = await active();
  assert.notEqual(second, start, 'next arrow switches platform');
  if (process.env.SHOT_PICKER) {
    await page.waitForTimeout(350);
    await page.locator('.platform-picker').screenshot({ path: process.env.SHOT_PICKER + '-2.png' });
  }
  await page.keyboard.press('ArrowLeft');
  assert.equal(await active(), start, 'ArrowLeft goes back');
  await carousel.getByRole('radio', { name: second }).click();
  assert.equal(await active(), second, 'side icon selects its platform');
  await page.getByRole('button', { name: 'Plataforma anterior' }).click();
  assert.equal(await active(), start);
  await page.getByRole('button', { name: 'Recolher menu' }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Próxima plataforma' }).isVisible(),
    false,
    'collapsed: arrows hidden',
  );
  if (process.env.SHOT_PICKER) {
    await page.waitForTimeout(300);
    await page.locator('.sidebar').screenshot({ path: process.env.SHOT_PICKER + '-3.png' });
  }
  await page.getByRole('button', { name: 'Expandir menu' }).click();
  const routes = ['home', 'content', 'analytics', 'planner', 'revenue', 'community', 'settings'];
  for (const route of routes) {
    await page.goto(`${origin}/#/${route}`);
    await page.waitForTimeout(700);
  }
  // Confirmations use the app's styled dialog, never the browser's native confirm().
  await page.goto(`${origin}/#/planner`);
  // Drag and drop: a card dropped on another day moves there.
  const firstChip = page.locator('.planner-chip').first();
  const chipTitle = await firstChip.locator('strong').textContent();
  const targetDay = page.locator('.planner-day:has(time[datetime="2026-11-26"])');
  // Both cells on screen, then a real pointer drag (HTML5 drag events, as a user does it).
  await targetDay.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const from = await firstChip.boundingBox(),
    to = await targetDay.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 6, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await targetDay.locator('.planner-chip', { hasText: chipTitle }).waitFor();
  if (process.env.SHOT_PLANNER) await page.screenshot({ path: process.env.SHOT_PLANNER + '-calendar.png' });
  await targetDay.locator('.planner-chip', { hasText: chipTitle }).click();
  const planner = page.locator('dialog.planner-drawer[open]');
  await planner.getByRole('button', { name: /Avançar para/ }).waitFor();
  if (process.env.SHOT_PLANNER) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: process.env.SHOT_PLANNER + '-drawer.png' });
  }
  await planner.getByRole('button', { name: 'Remover do planejamento' }).click();
  const confirmDialog = page.getByRole('dialog', { name: 'Remover este plano?' });
  await confirmDialog.waitFor();
  if (process.env.SHOT) {
    await page.waitForTimeout(400); // after the entry animation
    await page.screenshot({ path: process.env.SHOT });
  }
  // It must be on top of the plan editor (top layer), fully opaque and centered.
  const box = await confirmDialog.boundingBox();
  const topmost = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('dialog')?.className,
    [box.x + box.width / 2, box.y + 20],
  );
  assert.match(topmost ?? '', /confirm-dialog/, 'confirmation dialog is not on top');
  await confirmDialog.getByRole('button', { name: 'Cancelar' }).click();
  await confirmDialog.waitFor({ state: 'detached' });
  assert.equal(await planner.count(), 1, 'cancelling must keep the plan panel open');
  await planner.getByRole('button', { name: 'Fechar detalhes' }).click();
  await planner.waitFor({ state: 'detached' });
  if (process.env.SHOT_PLANNER) {
    await page.getByRole('button', { name: /Pipeline/ }).click();
    await page.screenshot({ path: process.env.SHOT_PLANNER + '-pipeline.png' });
  }

  // Amount mask follows the currency; browser autofill values ("40,00") stay in the field.
  await page.goto(`${origin}/#/revenue`);
  await page.getByRole('button', { name: 'Parcerias', exact: true }).click();
  await page.getByRole('button', { name: /Nova parceria/ }).click();
  const amountField = page.getByRole('textbox', { name: 'Valor' });
  await amountField.pressSequentially('1000000');
  assert.equal(await amountField.inputValue(), '10.000,00', 'BRL mask');
  await page.getByRole('combobox', { name: 'Moeda' }).selectOption('USD');
  assert.equal(await amountField.inputValue(), '10,000.00', 'USD mask');
  if (process.env.SHOT_AMOUNT)
    await page.locator('form').filter({ has: amountField }).screenshot({ path: process.env.SHOT_AMOUNT });
  await page.getByRole('combobox', { name: 'Moeda' }).selectOption('BRL');
  await amountField.fill('40,00');
  assert.equal(await amountField.inputValue(), '40,00', 'autofill value');

  // Regression: the score bar style must not paint the animated number behind the percentage.
  await page.goto(`${origin}/#/analytics`);
  await page.getByRole('button', { name: 'Engajamento', exact: true }).click();
  const scoreNumber = page.locator('.engagement-score strong .animated-number span').last();
  await scoreNumber.waitFor();
  assert.equal(await scoreNumber.evaluate(el => getComputedStyle(el).backgroundImage), 'none', 'score number painted');
  assert.match(await page.getByText(/Dados das plataformas conectadas · v\d+\.\d+\.\d+/).innerText(), /v\d/);

  // F5 keeps the session (sessionStorage, same tab).
  await page.reload();
  await page.locator('.logout-button').first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Continuar com Google / YouTube' }).count(), 0, 'F5 logged out');
  // Logout clears it: a reload shows the login screen again.
  await page.locator('.logout-button').first().click();
  await page.getByRole('button', { name: 'Continuar com Google / YouTube' }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Continuar com Google / YouTube' }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('serial-session')), null, 'session left in storage');

  const violations = await page.evaluate(() => window.__cspViolations);
  assert.deepEqual(violations, [], 'CSP violations');
  assert.deepEqual(errors, [], 'runtime errors');
  console.log(
    `PASS: CSP present; login, platform carousel, ${routes.length} tabs, styled confirmation (no native dialogs), currency amount mask, score styling, version label, F5 keeps session, logout + F5 shows login; no violations or runtime errors.`,
  );
} finally {
  await browser?.close();
  await server?.close();
  rmSync(outDir, { recursive: true, force: true });
}
