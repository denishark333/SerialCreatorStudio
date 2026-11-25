// Private, bounded, session-memory cache. No channel data or tokens go to storage.
import { apiSession } from './apiSession';
type Entry = { body: string; signature: string; headers: Headers; checked: number };
const entries = new Map<string, Entry>(),
  pending = new Map<string, Promise<Response>>();
const freshness = 30000;
let generation = 0;
const response = (entry: Entry) => new Response(entry.body, { status: 200, headers: entry.headers });
const signature = (body: string) => {
  try {
    const value = JSON.parse(body);
    return JSON.stringify({ data: value.data, pagination: value.pagination });
  } catch {
    return body;
  }
};
function changed() {
  dispatchEvent(new CustomEvent('serial-data-updated', { detail: { cacheRefresh: true } }));
}
export function clearDataCache() {
  generation++;
  entries.clear();
  pending.clear();
}
addEventListener('serial-data-updated', event => {
  if ((event as CustomEvent).detail?.cacheRefresh) return;
  for (const entry of entries.values()) entry.checked = 0;
});
export async function dataFetch(input: URL | string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input)),
    method = (init.method ?? 'GET').toUpperCase(),
    headers = new Headers(init.headers),
    authorization = headers.get('Authorization') ?? '';
  const network = async () => {
    const result = await fetch(input, init);
    if (result.status === 401 && apiSession.token && authorization === 'Bearer ' + apiSession.token)
      dispatchEvent(
        new CustomEvent('serial-session-ended', { detail: { message: 'Sua sessão foi encerrada. Entre novamente.' } }),
      );
    return result;
  };
  const eligible =
    url.pathname.startsWith('/api/v1/workspaces/') &&
    !url.pathname.includes('/sync') &&
    !url.pathname.endsWith('/preferences');
  if (method !== 'GET' || !eligible) {
    const result = await network();
    if (method !== 'GET' && result.ok && eligible) {
      clearDataCache();
    }
    return result;
  }
  url.searchParams.sort();
  const key = authorization + '|' + url.href,
    old = entries.get(key),
    epoch = generation;
  const load = () => {
    const existing = pending.get(key);
    if (existing) return existing.then(r => r.clone());
    const request = network()
      .then(async result => {
        if (result.ok && epoch === generation) {
          const body = await result.clone().text(),
            next = { body, signature: signature(body), headers: new Headers(result.headers), checked: Date.now() };
          entries.delete(key);
          entries.set(key, next);
          while (entries.size > 150) entries.delete(entries.keys().next().value!);
          if (old && old.signature !== next.signature) changed();
        }
        return result;
      })
      .finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
    pending.set(key, request);
    return request.then(r => r.clone());
  };
  if (old) {
    if (Date.now() - old.checked >= freshness) void load().catch(() => {});
    return response(old);
  }
  return load();
}
