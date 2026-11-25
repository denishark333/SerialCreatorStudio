import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StreamGoal } from '../overview/StreamGoal';
import { mockApi } from './api';

describe('StreamGoal', () => {
  it('starts on a metric the platform provides and saves each metric on its own', async () => {
    const api = mockApi(call =>
      call.path.endsWith('/subscriber-goal') && call.method === 'GET'
        ? {
            data: {
              metric: call.query.get('metric'),
              target: call.query.get('metric') === 'kick.subscribers' ? 10 : null,
            },
          }
        : undefined,
    );
    render(<StreamGoal platform="Kick" followers={null} subscribers={4} onError={() => {}} />);
    // Kick does not report followers: paid subscribers first.
    expect(screen.getByRole('button', { name: 'Assinantes' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(screen.getByText(/Faltam/)).toBeTruthy());
    expect(api.calls.some(c => c.query.get('metric') === 'kick.subscribers')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Seguidores' }));
    expect(await screen.findByText(/A API da Kick não informa o total de seguidores/)).toBeTruthy();
    const input = screen.getByRole('spinbutton', { name: 'Meta de seguidores' });
    await userEvent.type(input, '500');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar meta' }));
    await waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({ method: 'PATCH', body: { target: 500, metric: 'kick.followers' } }),
      ]),
    );
  });
});
