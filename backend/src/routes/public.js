import { randomUUID } from 'node:crypto';
import { LEGAL_VERSION } from '../legal.js';
import { renderCompletionPage } from '../oauth-return.js';
import { fail } from '../errors.js';
import { route } from '../http/router.js';
import { VERSION } from '../version.js';

const LEGAL_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const PROVIDERS = { google: 'YouTube', twitch: 'Twitch', kick: 'Kick' };
const clearOAuthCookie = slug => `serial_${slug}_oauth=; HttpOnly; SameSite=Lax; Path=/api/v1/oauth/${slug}; Max-Age=0`;

/** Routes reachable without a session or API token: health, legal pages, login and OAuth redirects. */
export function publicRoutes({ legal, auth, youtube, streams, requireConsent, afterConnection, storage }) {
  return [
    route('GET', '/api/v1/oauth/complete', ({ respond }) => {
      const nonce = randomUUID();
      respond.html(
        renderCompletionPage(nonce),
        `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      );
    }),
    route('GET', '/api/v1/legal', ({ respond }) => respond.json(200, { data: legal.metadata })),
    route('GET', /^\/api\/v1\/legal\/(privacy|terms)$/, ({ respond }, kind) =>
      respond.html(legal.page(kind), LEGAL_CSP),
    ),
    route('GET', '/api/v1/auth/options', ({ respond }) =>
      respond.json(200, { data: { inviteRequired: Boolean(auth?.inviteRequired) } }),
    ),
    route('GET', '/health', ({ respond }) =>
      respond.json(200, { status: 'ok', mode: 'live', version: VERSION, storage }),
    ),

    route(
      'POST',
      '/api/v1/auth/login/poll',
      async ({ respond, body }) => {
        const value = await body();
        respond.json(200, { data: auth.poll(value.id, value.secret) });
      },
      { when: () => Boolean(auth) },
    ),
    route(
      'POST',
      /^\/api\/v1\/auth\/login\/(google|twitch|kick)$/,
      async ({ clientAddress, respond, body }, slug) => {
        const accepted = requireConsent ? await body() : null;
        if (
          requireConsent &&
          (accepted?.privacyVersion !== LEGAL_VERSION || accepted?.termsVersion !== LEGAL_VERSION)
        ) {
          fail(400, 'CONSENT_REQUIRED', 'Leia e aceite os termos e a politica de privacidade atuais.');
        }
        const provider = PROVIDERS[slug];
        const consent = accepted
          ? { privacyVersion: accepted.privacyVersion, termsVersion: accepted.termsVersion }
          : null;
        const invite =
          typeof accepted?.inviteCode === 'string' && accepted.inviteCode.length <= 64 ? accepted.inviteCode : null;
        const flow = auth.begin(provider, clientAddress, 'login', null, consent, invite);
        try {
          const result =
            provider === 'YouTube' ? youtube.authorize(null, flow.id) : streams.authorize(null, provider, flow.id);
          respond.json(200, { data: { ...flow, ...result } });
        } catch (error) {
          auth.reject(flow.id);
          throw error;
        }
      },
      { when: () => Boolean(auth) },
    ),

    route(
      'GET',
      '/api/v1/oauth/google/start',
      async ({ respond, query }) => {
        const result = await youtube.start(query.get('ticket'));
        respond.redirect(302, result.url, result.cookie);
      },
      { when: () => Boolean(youtube) },
    ),
    route(
      'GET',
      '/api/v1/oauth/google/callback',
      async ({ req, respond, query }) => {
        const result = await youtube.callback(query, req.headers.cookie);
        if (result.workspaceId && !result.mergePending) afterConnection(result.workspaceId);
        respond.redirect(303, result.location, clearOAuthCookie('google'));
      },
      { when: () => Boolean(youtube) },
    ),
    route(
      'GET',
      /^\/api\/v1\/oauth\/(twitch|kick)\/(start|callback)$/,
      async ({ req, respond, query }, slug, step) => {
        const platform = PROVIDERS[slug];
        if (step === 'start') {
          const result = streams.start(platform, query.get('ticket'));
          return respond.redirect(302, result.url, result.cookie);
        }
        const result = await streams.callback(platform, query, req.headers.cookie);
        if (result.workspaceId && !result.mergePending) afterConnection(result.workspaceId);
        respond.redirect(303, result.location, clearOAuthCookie(slug));
      },
      { when: () => Boolean(streams) },
    ),
  ];
}
