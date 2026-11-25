/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/**
 * Content-Security-Policy for the production build (as a <meta> tag, so it ships with dist/ on any host).
 * Not applied in `vite dev`: React Refresh needs an inline script there.
 * - connect-src: only this site and the configured API (VITE_API_URL).
 * - img-src https: platform thumbnails/avatars come from several CDNs (ytimg, ggpht, jtvnw, kick).
 * - fonts: Google Fonts stylesheet + font files.
 * frame-ancestors cannot be set via <meta>; send it as an HTTP header from the web server if needed.
 */
function contentSecurityPolicy(apiUrl: string): Plugin {
  const api = new URL(apiUrl).origin;
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    `connect-src 'self' ${api}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'serial-content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  };
}

/** `vite dev` prints which API the dashboard talks to, and warns when it is a remote one (real data). */
function announceApi(apiUrl: string): Plugin {
  const { hostname } = new URL(apiUrl);
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  return {
    name: 'serial-announce-api',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const note = local ? '' : '  ⚠ API REMOTA: ações afetam dados e contas reais (.env.local)';
        server.config.logger.info(`\n  API: ${apiUrl}${note}\n`);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiUrl = env.VITE_API_URL || 'http://localhost:4000';
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  return {
    plugins: [react(), contentSecurityPolicy(apiUrl), announceApi(apiUrl)],
    define: { __APP_VERSION__: JSON.stringify(version) },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.tsx'],
      setupFiles: ['src/test/setup.ts'],
    },
    build: {
      rolldownOptions: {
        output: {
          // Separate long-lived chunks: chart libraries (loaded with the signed-in screens) and the rest of
          // node_modules. React must stay in `vendor`: if it lands in `charts`, the login page downloads the charts.
          codeSplitting: {
            groups: [
              {
                name: 'vendor',
                test: /node_modules[\/](react|react-dom|scheduler)[\/]/,
                priority: 20,
              },
              {
                name: 'charts',
                test: /node_modules[\/](recharts|d3-[^\/]+|victory-vendor|react-smooth|reselect|immer|redux|react-redux|@reduxjs[\/]toolkit|use-sync-external-store|decimal\.js-light|eventemitter3|tiny-invariant|es-toolkit)[\/]/,
                priority: 10,
              },
              { name: 'vendor', test: /node_modules/, priority: 0 },
            ],
          },
        },
      },
    },
  };
});
