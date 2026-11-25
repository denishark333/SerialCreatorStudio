import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudioPlanner } from '../StudioPlanner';
import { answerConfirm, channel, forbidNativeConfirm, mockApi } from './api';

// Fixture plans are on 2026-11-18..24; pin "today" inside that month (São Paulo noon).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const renderPlanner = () => render(<StudioPlanner />);

describe('StudioPlanner', () => {
  it('shows the plans of the current month', async () => {
    mockApi();
    renderPlanner();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('4 conteúdos planejados neste mês · todas as plataformas'),
    );
  });

  it('creates a plan for today with the selected channel and initial stage', async () => {
    const api = mockApi();
    renderPlanner();
    await screen.findByText('4 conteúdos planejados neste mês · todas as plataformas');
    await userEvent.click(screen.getByRole('button', { name: /Planejar conteúdo/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Título' }), 'Review do novo jogo');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    const [write] = api.writes();
    expect(write.method).toBe('POST');
    expect(write.path).toMatch(/\/plans$/);
    expect(write.body).toEqual({
      title: 'Review do novo jogo',
      channelId: channel.id,
      format: 'Vídeo',
      date: '2026-11-16',
      stage: 'Ideia',
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Salvar plano' })).toBeNull());
  });

  const chip = (title: string) => screen.getAllByText(title)[0].closest<HTMLElement>('[role=button]')!;

  it('drags a plan to another stage in the pipeline', async () => {
    const api = mockApi();
    renderPlanner();
    await screen.findByText('4 conteúdos planejados neste mês · todas as plataformas');
    await userEvent.click(screen.getByRole('button', { name: /Pipeline/ }));
    const card = chip('Uma nova aventura começa aqui');
    const column = screen.getByRole('region', { name: 'Gravação' });
    fireEvent.dragStart(card);
    fireEvent.dragOver(column);
    expect(column.className).toContain('is-drop-target');
    fireEvent.drop(column);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        path: expect.stringMatching(/\/plans\/plan-0$/),
        body: { stage: 'Gravação' },
      }),
    );
    // The card moved at once (optimistic) and stays there.
    expect(within(column).getByText('Uma nova aventura começa aqui')).toBeTruthy();
  });

  it('drags a plan to another day in the calendar, and puts it back if the API refuses', async () => {
    const api = mockApi(call =>
      call.method === 'PATCH' && call.body.date === '2026-11-27'
        ? { status: 400, body: { error: { code: 'INVALID_DATE', message: 'Data recusada.' } } }
        : undefined,
    );
    renderPlanner();
    await screen.findByText('4 conteúdos planejados neste mês · todas as plataformas');
    const day = (label: string) => screen.getByRole('group', { name: label });
    fireEvent.dragStart(chip('Uma nova aventura começa aqui'));
    fireEvent.dragOver(day('25/11/2026'));
    fireEvent.drop(day('25/11/2026'));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({ date: '2026-11-25' });
    expect(within(day('25/11/2026')).getByText('Uma nova aventura começa aqui')).toBeTruthy();

    fireEvent.dragStart(chip('Uma nova aventura começa aqui'));
    fireEvent.drop(day('27/11/2026'));
    expect(await screen.findByText('Data recusada.')).toBeTruthy();
    expect(within(day('25/11/2026')).getByText('Uma nova aventura começa aqui')).toBeTruthy();
    expect(within(day('27/11/2026')).queryByText('Uma nova aventura começa aqui')).toBeNull();
  });

  it('advances a plan stage by stage in the detail panel and saves its notes and time', async () => {
    const api = mockApi();
    renderPlanner();
    await screen.findByText('4 conteúdos planejados neste mês · todas as plataformas');
    await userEvent.click(chip('Uma nova aventura começa aqui'));
    const panel = await screen.findByRole('dialog', { name: 'Uma nova aventura começa aqui' });
    expect(within(panel).getByRole('button', { name: /Voltar etapa/ })).toHaveProperty('disabled', true);
    await userEvent.click(within(panel).getByRole('button', { name: /Avançar para Roteiro/ }));
    await userEvent.click(await within(panel).findByRole('button', { name: /Avançar para Gravação/ }));
    expect(within(panel).getByText('Gravação', { selector: 'li' }).getAttribute('aria-current')).toBe('step');
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Notas' }), 'Gravar antes das 11h');
    await userEvent.tab();
    await waitFor(() => expect(api.writes()).toHaveLength(3));
    expect(api.writes().map(w => w.body)).toEqual([
      { stage: 'Roteiro' },
      { stage: 'Gravação' },
      { notes: 'Gravar antes das 11h' },
    ]);
  });

  it('publishes a ready plan after confirmation', async () => {
    const api = mockApi();
    forbidNativeConfirm();
    renderPlanner();
    await screen.findByText('4 conteúdos planejados neste mês · todas as plataformas');
    const ready = screen
      .getAllByText('Pronto', { selector: '.planner-chip-stage' })[0]
      .closest<HTMLElement>('[role=button]')!;
    await userEvent.click(ready);
    const panel = await screen.findByRole('dialog', { name: /./ });
    expect(within(panel).queryByRole('button', { name: /Avançar/ })).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: /Publicar/ }));
    await answerConfirm('Marcar como publicado?', 'confirm');
    await waitFor(() => expect(api.writes()).toEqual([expect.objectContaining({ body: { stage: 'Publicado' } })]));
    expect(await within(panel).findByText('Publicado', { selector: '.planner-published-badge' })).toBeTruthy();
  });

  it('asks for confirmation before removing a plan', async () => {
    const api = mockApi();
    forbidNativeConfirm();
    renderPlanner();
    await screen.findByText('4 conteúdos planejados neste mês · todas as plataformas');
    await userEvent.click(screen.getByRole('button', { name: /Pipeline/ }));
    await userEvent.click(screen.getAllByText('Uma nova aventura começa aqui')[0]);
    await userEvent.click(await screen.findByRole('button', { name: /Remover/ }));
    await answerConfirm('Remover este plano?', 'cancel');
    expect(api.writes()).toHaveLength(0);
    // Confirming removes it.
    await userEvent.click(screen.getByRole('button', { name: /Remover/ }));
    await answerConfirm('Remover este plano?', 'confirm');
    await waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({ method: 'DELETE', path: expect.stringMatching(/\/plans\/plan-0$/) }),
      ]),
    );
  });

  it('offers a live only the stages it has (no recording or editing)', async () => {
    const api = mockApi();
    renderPlanner();
    await screen.findByText('4 conteúdos planejados neste mês · todas as plataformas');
    await userEvent.click(screen.getByRole('button', { name: /Planejar conteúdo/ }));
    const stage = screen.getByRole('combobox', { name: 'Etapa' });
    await userEvent.selectOptions(stage, 'Edição');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Formato' }), 'Live');
    expect(
      within(stage)
        .getAllByRole('option')
        .map(o => o.textContent),
    ).toEqual(['Ideia', 'Pauta', 'Pronto']);
    expect((stage as HTMLSelectElement).value).toBe('Roteiro');
    await userEvent.type(screen.getByRole('textbox', { name: 'Título' }), 'Live de sexta');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual(expect.objectContaining({ format: 'Live', stage: 'Roteiro' }));
  });

  const listOf = (data: unknown[]) => ({
    data,
    pagination: { page: 1, limit: 100, total: data.length, totalPages: 1 },
  });

  it('shows confirmed brand deals without a plan on their date and plans them', async () => {
    const deal = (id: string, stage: string, date: string) => ({
      id,
      channelId: channel.id,
      title: 'Publi ' + id,
      type: 'deal',
      amountCents: 240000,
      currency: 'BRL',
      date,
      stage,
      source: 'manual',
    });
    const api = mockApi(call =>
      call.method === 'GET' && call.path.endsWith('/financial/deals')
        ? listOf([deal('A', 'Confirmado', '2026-11-27'), deal('B', 'Negociação', '2026-11-27')])
        : undefined,
    );
    renderPlanner();
    await screen.findByText('4 conteúdos planejados neste mês · todas as plataformas');
    const marker = await screen.findByRole('button', { name: 'Planejar a publi Publi A' });
    expect(screen.queryByRole('button', { name: 'Planejar a publi Publi B' })).toBeNull(); // not closed yet
    await userEvent.click(marker);
    expect(screen.getByText('Para a publi confirmada: Publi A')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual(
      expect.objectContaining({ title: 'Publi A', date: '2026-11-27', dealId: 'A', channelId: channel.id }),
    );
  });

  it('keeps a ready live scheduled until its day (a "pauta", not a script)', async () => {
    const live = (id: string, date: string) => ({
      id,
      workspaceId: 'w',
      channelId: channel.id,
      platform: 'YouTube',
      title: 'Live ' + date,
      format: 'Live',
      date,
      stage: 'Pronto',
      createdAt: '',
      updatedAt: '',
    });
    mockApi(call =>
      call.method === 'GET' && call.path.endsWith('/plans')
        ? listOf([live('future', '2026-11-20'), live('today', '2026-11-16')])
        : undefined,
    );
    renderPlanner();
    await screen.findAllByText('Live 2026-11-20');
    await userEvent.click(chip('Live 2026-11-20'));
    let panel = await screen.findByRole('dialog', { name: 'Live 2026-11-20' });
    expect(within(panel).getByText(/Agendada · em 4 dias/)).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: /realizada/ })).toBeNull();
    expect(within(panel).getByText('Pauta', { selector: 'li' })).toBeTruthy();
    await userEvent.click(within(panel).getByRole('button', { name: 'Fechar detalhes' }));
    await userEvent.click(chip('Live 2026-11-16'));
    panel = await screen.findByRole('dialog', { name: 'Live 2026-11-16' });
    expect(within(panel).getByRole('button', { name: /Marcar como realizada/ })).toBeTruthy();
  });

  it('plans a multistream live on several platforms and warns about plans at the same time', async () => {
    const twitch = { ...channel, id: 'tw-1', platform: 'Twitch', name: 'Canal Twitch' };
    const kick = { ...channel, id: 'kk-1', platform: 'Kick', name: 'Canal Kick' };
    const api = mockApi(call => {
      if (call.method === 'GET' && call.path.endsWith('/channels')) return listOf([channel, twitch, kick]);
      if (call.method === 'GET' && call.path.endsWith('/plans'))
        return listOf([
          {
            id: 'multi',
            workspaceId: 'w',
            channelId: twitch.id,
            channelIds: [twitch.id, channel.id, kick.id],
            platforms: ['Twitch', 'YouTube', 'Kick'],
            platform: 'Twitch',
            title: 'Live de sábado',
            format: 'Live',
            date: '2026-11-21',
            time: '20:00',
            stage: 'Roteiro',
            createdAt: '',
            updatedAt: '',
          },
        ]);
      return undefined;
    });
    renderPlanner();
    const card = chip(await screen.findByText('Live de sábado').then(e => e.textContent!));
    expect(within(card).getByText('MultiStream')).toBeTruthy();
    expect(within(card).getByRole('img', { name: 'Twitch, YouTube, Kick' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Planejar em 2026-11-21' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Formato' }), 'Live');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Canal Twitch' }));
    expect(screen.getAllByText('MultiStream').length).toBeGreaterThan(1);
    // The first channel can't be the last one left.
    await userEvent.click(screen.getByRole('checkbox', { name: channel.name }));
    expect(screen.getByRole('checkbox', { name: 'Canal Twitch' })).toHaveProperty('disabled', true);
    await userEvent.click(screen.getByRole('checkbox', { name: channel.name }));
    fireEvent.change(screen.getByLabelText('Horário'), { target: { value: '20:30' } });
    expect(screen.getByText(/Horário próximo de “Live de sábado” \(Live · 20:00\)/)).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'Título' }), 'Collab');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual(
      expect.objectContaining({ format: 'Live', channelId: 'tw-1', channelIds: ['tw-1', channel.id], time: '20:30' }),
    );
  });

  it('fills the calendar with published content and shows a delivered deal instead of its marker', async () => {
    const api = mockApi(call => {
      if (call.method === 'GET' && call.path.endsWith('/plans/records'))
        return {
          data: [
            {
              id: 'vod-1',
              kind: 'content',
              channelId: channel.id,
              platform: 'YouTube',
              title: 'Live com a Marca A',
              format: 'VOD',
              date: '2026-11-05',
              time: '19:00',
              thumbnailUrl: null,
              watchUrl: 'https://example.invalid/vod-1',
              views: 604,
              game: 'Aion 2',
              deal: { id: 'A', title: 'Marca A' },
            },
          ],
        };
      if (call.method === 'GET' && call.path.endsWith('/financial/deals'))
        return listOf([
          {
            id: 'A',
            channelId: channel.id,
            title: 'Marca A',
            type: 'deal',
            amountCents: 1000,
            currency: 'BRL',
            date: '2026-11-04',
            endDate: '2026-11-06',
            stage: 'Confirmado',
            source: 'manual',
          },
        ]);
      return undefined;
    });
    renderPlanner();
    const record = await screen.findByRole('button', { name: /Live com a Marca A \(realizada na YouTube\)/ });
    expect(within(record).getByText('Aion 2')).toBeTruthy();
    expect(within(record).getByText(/Publi entregue · Marca A/)).toBeTruthy();
    // A click opens the side panel (not the platform): link to the VOD and "add to the plan".
    await userEvent.click(record);
    const panel = await screen.findByRole('dialog', { name: 'Live com a Marca A' });
    expect(
      within(panel)
        .getByRole('link', { name: /Abrir na YouTube/ })
        .getAttribute('href'),
    ).toBe('https://example.invalid/vod-1');
    await userEvent.click(within(panel).getByRole('button', { name: /Adicionar ao planejamento/ }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({
      title: 'Live com a Marca A',
      channelId: channel.id,
      format: 'Live',
      date: '2026-11-05',
      stage: 'Publicado',
      time: '19:00',
      contentId: 'vod-1',
    });
    // Delivered: no "plan this deal" marker.
    expect(screen.queryByRole('button', { name: 'Planejar a publi Marca A' })).toBeNull();
  });

  it('surfaces validation errors from the API', async () => {
    mockApi(call =>
      call.method === 'POST'
        ? {
            status: 400,
            body: { error: { code: 'INVALID_FIELD', message: 'title deve ter entre 1 e 120 caracteres.' } },
          }
        : undefined,
    );
    renderPlanner();
    await screen.findByText('4 conteúdos planejados neste mês · todas as plataformas');
    await userEvent.click(screen.getByRole('button', { name: /Planejar conteúdo/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Título' }), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));
    expect((await screen.findAllByRole('alert')).some(a => a.textContent?.includes('entre 1 e 120'))).toBe(true);
  });
});
