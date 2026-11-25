import { createServer as createPortProbe } from 'node:net';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readdir, writeFile, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewFixtures } from './preview-fixtures.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)),
  output = join(root, 'src/assets/previews');
const width = 960,
  height = 640,
  fps = 24,
  duration = 20,
  frames = fps * duration;
async function encoderPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA, 'ms-playwright')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library/Caches/ms-playwright')
        : join(homedir(), '.cache/ms-playwright'));
  for (const dir of (await readdir(cache))
    .filter(v => v.startsWith('ffmpeg-'))
    .sort()
    .reverse()) {
    for (const name of ['ffmpeg-win64.exe', 'ffmpeg-linux', 'ffmpeg-mac', 'ffmpeg-mac-arm64']) {
      const path = join(cache, dir, name);
      try {
        await stat(path);
        return path;
      } catch {}
    }
  }
  throw Error('FFmpeg not found. Run npx playwright install chromium, or set FFMPEG_PATH.');
}
const probe = createPortProbe();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true } });
let browser, encoder;
try {
  await mkdir(output, { recursive: true });
  const ffmpeg = await encoderPath();
  await server.listen();
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port,
    fixture = previewFixtures(origin);
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  // All API calls are intercepted. No real account, backend, cookies or data are used.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/v1/')) return route.fulfill({ json: fixture(url.pathname, url.searchParams) });
    if (url.hostname === 'preview.invalid') return route.fulfill({ body: 'Preview authentication' });
    if (url.origin === origin) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/#/home');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continuar com Google / YouTube' }).click();
  await page.locator('.interactive-retention').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content:
      'body{scrollbar-width:none} .preview-watermark{position:fixed;right:16px;bottom:12px;z-index:9999;background:#131b24e8;color:#cbd1d9;border:1px solid #ffffff26;border-radius:20px;padding:5px 10px;font:10px system-ui;letter-spacing:1px;text-transform:uppercase}',
  });
  await page.evaluate(() => {
    const label = document.createElement('span');
    label.className = 'preview-watermark';
    label.textContent = 'Demonstração · dados fictícios';
    document.body.append(label);
  });
  await page.getByRole('button', { name: 'Recolher menu' }).click();
  await page.waitForTimeout(1000);
  // Presentation-only timing: leave the dashboard's normal navigation unchanged.
  await page.addStyleTag({
    content:
      '.sidebar{transition:width 850ms ease,padding 850ms ease!important}.app>main{transition:margin-left 850ms ease!important}',
  });
  // Advance the real UI's animation clock at exactly 24 fps, independent of render speed.
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const canvasPage = await context.newPage();
  await canvasPage.goto('about:blank');
  await canvasPage.setContent(`<canvas width="${width}" height="${height}"></canvas>`);
  const navigate = async route => {
    await page.locator(`a[href="#/${route}"]`).first().click();
  };
  const tab = async name => {
    await page.getByRole('button', { name, exact: true }).click();
  };
  const cues = new Map(
    [
      [12, () => page.getByRole('button', { name: 'Expandir menu' }).click()],
      [46, () => navigate('content')],
      [68, () => page.locator('.studio-tabs button').nth(1).click()],
      [88, () => navigate('analytics')],
      [108, () => tab('Alcance')],
      [128, () => tab('Engajamento')],
      [152, () => navigate('planner')],
      [172, () => page.locator('.tabs button').filter({ hasText: 'Pipeline' }).click()],
      [188, () => navigate('revenue')],
      [206, () => navigate('community')],
      [218, () => navigate('home')],
      [226, () => page.getByRole('button', { name: 'Recolher menu' }).click()],
    ].map(([frame, action]) => [frame * 2, action]),
  );
  const temporary = join(output, 'login-preview.pending.webm');
  encoder = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      String(fps),
      '-c:v',
      'mjpeg',
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '36',
      '-b:v',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-y',
      temporary,
    ],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let errorLog = '';
  encoder.stderr.on('data', data => {
    errorLog = (errorLog + data).slice(-2000);
    process.stderr.write(data);
  });
  encoder.stdin.on('error', () => {});
  const completed = once(encoder, 'exit');
  let firstShot;
  for (let frame = 0; frame < frames; frame++) {
    if (cues.has(frame)) {
      await cues.get(frame)();
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    await page.clock.runFor(1000 / fps);
    // Keep a complete settled opening/closing frame for a seamless loop.
    const shot =
      frame >= frames - 2 ? firstShot : (await page.screenshot({ type: 'jpeg', quality: 92 })).toString('base64');
    if (frame === 0) firstShot = shot;
    const jpeg = await canvasPage.evaluate(
      async ({ shot, width, height }) => {
        const image = new Image();
        image.src = 'data:image/jpeg;base64,' + shot;
        await image.decode();
        const canvas = document.querySelector('canvas'),
          ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', 0.94).split(',')[1];
      },
      { shot, width, height },
    );
    if (!encoder.stdin.write(Buffer.from(jpeg, 'base64')))
      await Promise.race([
        once(encoder.stdin, 'drain'),
        completed.then(() => {
          throw Error('Encoder closed: ' + errorLog);
        }),
      ]);
    if (frame % 48 === 0) process.stdout.write(`Rendering ${Math.round((frame / frames) * 100)}%\n`);
  }
  if (errors.length) throw Error(errors.join('\n'));
  encoder.stdin.end();
  const [code] = await completed;
  if (code !== 0) throw Error('Video encoding failed: ' + errorLog);
  await rename(temporary, join(output, 'login-preview.webm'));
  const poster = await canvasPage.evaluate(() => {
    const canvas = document.querySelector('canvas'),
      ctx = canvas.getContext('2d');
    ctx.globalAlpha = 1;
    return canvas.toDataURL('image/webp', 0.83).split(',')[1];
  });
  await writeFile(join(output, 'login-preview.webp'), Buffer.from(poster, 'base64'));
  const size = (await stat(join(output, 'login-preview.webm'))).size;
  console.log(
    `Generated ${duration}s preview (${Math.round(size / 1024)} KiB) and poster. No real API requests were made.`,
  );
} finally {
  encoder?.stdin?.destroy();
  if (encoder?.exitCode === null) encoder.kill();
  await browser?.close();
  await server.close();
}
