import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudioOverview } from '../StudioOverview';
import type { Report } from '../liveTypes';
import { channel, mockApi } from './api';

const goalPanel = () => screen.getByRole('heading', { name: 'Sua próxima meta' }).closest('section') as HTMLElement;

function renderOverview(channels = [channel]) {
  const api = mockApi();
  const report = api.fixtures('/overview') as Report;
  render(
    <StudioOverview report={report} channels={channels} from="2026-10-03" to="2026-11-01" contentFormat="Vídeo" />,
  );
  return { api, report };
}

describe('StudioOverview', () => {
  it('shows channel activity, featured videos and community questions from the API', async () => {
    const { report } = renderOverview();
    const activity = screen.getByRole('heading', { name: 'Atividade do canal' }).closest('section') as HTMLElement;
    const views = within(activity).getByLabelText(/mil/);
    expect(views.getAttribute('aria-label')).toBe(
      new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(
        report.summary.views ?? 0,
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Seus vídeos em destaque' })).toBeTruthy();
    const questions = screen
      .getByRole('heading', { name: 'Perguntas da comunidade' })
      .closest('section') as HTMLElement;
    expect(await within(questions).findByText('Como você organiza os próximos conteúdos?')).toBeTruthy();
  });

  it('tracks the subscriber goal and saves a new target', async () => {
    const { api } = renderOverview();
    await waitFor(() => expect(within(goalPanel()).getByText(/Faltam/)).toBeTruthy());
    expect(within(goalPanel()).getByLabelText('30 mil')).toBeTruthy();
    expect(within(goalPanel()).getByLabelText('5,2 mil')).toBeTruthy(); // 30 000 − 24 800

    // The field starts with the current goal; replace it.
    const input = screen.getByRole('spinbutton', { name: 'Meta de inscritos' }) as HTMLInputElement;
    expect(input.value).toBe('30000');
    await userEvent.clear(input);
    await userEvent.type(input, '50000');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar meta' }));
    await waitFor(() => expect(within(goalPanel()).getByLabelText('50 mil')).toBeTruthy());
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path: expect.stringMatching(/subscriber-goal$/),
        body: { target: 50000 },
      }),
    ]);
  });

  it('does not invent goal progress when the channel hides its subscriber count', async () => {
    renderOverview([{ ...channel, subscribers: null }]);
    expect(
      await within(goalPanel()).findByText('Defina uma meta de inscritos para acompanhar sua evolução.'),
    ).toBeTruthy();
    expect(within(goalPanel()).queryByText(/Faltam/)).toBeNull();
  });
});
