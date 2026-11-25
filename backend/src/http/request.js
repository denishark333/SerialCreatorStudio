import { timingSafeEqual } from 'node:crypto';
import { fail } from '../errors.js';

const MAX_BODY_BYTES = 65536;

/** Constant-time comparison for credentials. */
export function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const IP_ADDRESS = /^[0-9a-fA-F:.]{2,45}$/;

const validIp = value => (typeof value === 'string' && IP_ADDRESS.test(value.trim()) ? value.trim() : null);

/**
 * Client address used for rate limiting. Behind the local Nginx every socket is 127.0.0.1, so with
 * `trustProxy` the `X-Real-IP` header (overwritten by Nginx with $remote_addr) is used instead —
 * but only for connections that really come from loopback, so the header cannot be spoofed directly.
 *
 * Cloudflare Tunnel: `cloudflared` runs on the same machine and connects to Nginx from loopback, so
 * X-Real-IP is loopback for every visitor. Only in that case the `CF-Connecting-IP` header (set by
 * Cloudflare) is used. A client reaching Nginx directly has its own address in X-Real-IP and cannot
 * choose CF-Connecting-IP.
 */
export function clientAddress(req, trustProxy = false) {
  const socket = req.socket.remoteAddress ?? 'unknown';
  if (!trustProxy || !LOOPBACK.has(socket)) return socket;
  const forwarded = validIp(req.headers['x-real-ip']);
  if (!forwarded) return socket;
  if (LOOPBACK.has(forwarded)) return validIp(req.headers['cf-connecting-ip']) ?? forwarded;
  return forwarded;
}

/** Reads a JSON body (max 64 KiB). */
export async function readJsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
    fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) fail(413, 'BODY_TOO_LARGE', 'Limite de 64 KiB.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail(400, 'INVALID_JSON', 'JSON inválido.');
  }
}

/** Slices a list using ?page= and ?limit= (max 100). */
export function paginate(items, params) {
  const parse = (key, fallback, max) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) {
      fail(400, 'INVALID_PAGINATION', `${key} inválido.`);
    }
    return Number(raw);
  };
  const page = parse('page', 1, 1000000);
  const limit = parse('limit', 25, 100);
  return {
    data: items.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: items.length, totalPages: Math.ceil(items.length / limit) },
  };
}

/** Response helpers bound to one ServerResponse. */
export function createResponder(res) {
  return {
    json(status, payload) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    },
    noContent() {
      res.writeHead(204);
      res.end();
    },
    html(content, contentSecurityPolicy) {
      res.setHeader('Content-Security-Policy', contentSecurityPolicy);
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    },
    redirect(status, location, cookie) {
      if (cookie) res.setHeader('Set-Cookie', cookie);
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.writeHead(status, { Location: location });
      res.end();
    },
  };
}
