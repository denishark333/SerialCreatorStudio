// Fake Serial API for component tests: GETs are answered by the shared preview fixtures,
// writes are recorded and can be answered per test.
import { vi } from 'vitest';
import { previewFixtures } from '../../scripts/preview-fixtures.mjs';
import type { ApiChannel } from '../api';

export type Call = { method: string; path: string; query: URLSearchParams; body: any };
type Handler = (call: Call) => unknown | undefined;

const fixtures = previewFixtures('http://localhost');

export const channel: ApiChannel = fixtures('/channels', new URLSearchParams()).data[0];

/** Installs the fake API. `handler` may return a JSON body (or `{ status, body }`) for any call it wants to own. */
export function mockApi(handler: Handler = () => undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const call: Call = {
        method: (init.method ?? 'GET').toUpperCase(),
        path: url.pathname,
        query: url.searchParams,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const custom = handler(call) as { status?: number; body?: unknown } | undefined;
      if (custom !== undefined) {
        const status = (custom as { status?: number }).status;
        const body = status !== undefined ? custom.body : custom;
        return status === 204
          ? new Response(null, { status })
          : new Response(JSON.stringify(body), {
              status: status ?? 200,
              headers: { 'Content-Type': 'application/json' },
            });
      }
      // Login endpoints are POSTs answered by the fixtures; other writes just succeed.
      if (call.method !== 'GET' && !call.path.includes('/auth/'))
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      return new Response(JSON.stringify(fixtures(url.pathname, url.searchParams)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return {
    calls,
    writes: () => calls.filter(c => c.method !== 'GET'),
    fixtures: (path: string, query = new URLSearchParams()) => fixtures(path, query).data,
  };
}

/** Answers the app's confirmation dialog (ConfirmDialog) titled `title`. */
export async function answerConfirm(title: string, choice: 'confirm' | 'cancel') {
  const { screen, within } = await import('@testing-library/react');
  const { default: userEvent } = await import('@testing-library/user-event');
  const dialog = await screen.findByRole('dialog', { name: title });
  const buttons = within(dialog).getAllByRole('button');
  await userEvent.click(choice === 'cancel' ? buttons[0] : buttons[1]);
}

/** Fails the test if any code path still uses the browser's native confirm(). */
export function forbidNativeConfirm() {
  return vi.spyOn(window, 'confirm').mockImplementation(() => {
    throw new Error('window.confirm() must not be used; use confirmAction()');
  });
}
