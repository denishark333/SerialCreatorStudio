import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlatformProvider } from '../PlatformContext';
import { StudioCatalog } from '../StudioCatalog';
import { mockApi } from './api';

const catalogRequests = (api: ReturnType<typeof mockApi>) => api.calls.filter(c => c.path.endsWith('/catalog'));
const renderCatalog = (search = '') =>
  render(
    <PlatformProvider>
      <StudioCatalog search={search} />
    </PlatformProvider>,
  );

describe('StudioCatalog', () => {
  it('lists the videos of the selected platform with the tab counts', async () => {
    const api = mockApi();
    renderCatalog();
    expect(await screen.findByText('Uma nova aventura começa aqui')).toBeTruthy();
    expect(screen.getByText('O próximo capítulo já começou')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Vídeos/ }).textContent).toContain('6');
    expect(screen.getByRole('button', { name: /Shorts/ }).textContent).toContain('3');
    const last = catalogRequests(api).at(-1)!;
    expect(last.query.get('kind')).toBe('videos');
    expect(last.query.getAll('channelId')).toEqual(['preview-channel']);
  });

  it('switches to Shorts using the confirmed format, not the duration', async () => {
    const api = mockApi();
    renderCatalog();
    await screen.findByText('Uma nova aventura começa aqui');
    await userEvent.click(screen.getByRole('button', { name: /Shorts/ }));
    expect(await screen.findByText('A jogada da semana')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Uma nova aventura começa aqui')).toBeNull());
    expect(catalogRequests(api).at(-1)!.query.get('format')).toBe('Short');
  });

  it('sends the header search to the API', async () => {
    const api = mockApi();
    renderCatalog('aventura');
    await screen.findByText('Uma nova aventura começa aqui');
    expect(catalogRequests(api).some(c => c.query.get('q') === 'aventura')).toBe(true);
  });
});
