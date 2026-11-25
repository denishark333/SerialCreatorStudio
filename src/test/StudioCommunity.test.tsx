import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudioCommunity } from '../StudioCommunity';
import { answerConfirm, channel, forbidNativeConfirm, mockApi } from './api';

const renderCommunity = () => render(<StudioCommunity channels={[channel]} channelId="" />);
const firstComment = async () => (await screen.findByText('Marina')).closest('article') as HTMLElement;

describe('StudioCommunity', () => {
  it('lists the comments returned by the API with their total', async () => {
    mockApi();
    renderCommunity();
    expect(await screen.findByText('Esse foi o melhor momento do vídeo!')).toBeTruthy();
    expect(screen.getAllByRole('article').length).toBe(4);
    expect(within(screen.getByRole('button', { name: /Comentários/ })).getByText('4')).toBeTruthy();
  });

  it('Heart/Pin link to the highlighted comment and open the docked YouTube window', async () => {
    mockApi();
    const popup = { opener: {}, location: { href: '' }, focus: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    renderCommunity();
    const heart = within(await firstComment()).getByRole('link', { name: /Heart/ });
    expect(heart.getAttribute('href')).toBe('https://www.youtube.com/watch?v=preview-0&lc=preview-comment-0');

    await userEvent.click(heart);
    expect(open).toHaveBeenCalledWith('', 'serial-youtube', expect.stringContaining('popup=yes'));
    expect(popup.opener).toBeNull();
    expect(popup.location.href).toBe(heart.getAttribute('href'));
  });

  it('hides a comment reversibly (held for review) through the moderation endpoint', async () => {
    const api = mockApi();
    renderCommunity();
    await userEvent.click(within(await firstComment()).getByRole('button', { name: /Ocultar no YouTube/ }));
    expect(await screen.findByText(/Comentário ocultado no YouTube/)).toBeTruthy();
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: expect.stringMatching(/community\/comments\/preview-comment-0\/moderation$/),
        body: { status: 'heldForReview' },
      }),
    ]);
  });

  it('deletes a comment only after the styled confirmation', async () => {
    forbidNativeConfirm();
    const api = mockApi();
    renderCommunity();
    await userEvent.click(within(await firstComment()).getByRole('button', { name: /Excluir comentário/ }));
    await answerConfirm('Excluir comentário?', 'cancel');
    expect(api.writes()).toEqual([]);
    await userEvent.click(within(await firstComment()).getByRole('button', { name: /Excluir comentário/ }));
    await answerConfirm('Excluir comentário?', 'confirm');
    expect(await screen.findByText('Comentário excluído do YouTube.')).toBeTruthy();
    expect(api.writes()).toEqual([expect.objectContaining({ body: { status: 'rejected' } })]);
  });

  it('a hidden comment offers Republicar and cannot be answered until then', async () => {
    const api = mockApi(call => {
      if (call.method !== 'GET' || !call.path.endsWith('/community/comments')) return undefined;
      const page = api.fixtures(call.path, call.query) as Array<Record<string, unknown>>;
      return {
        data: page.map(c => ({ ...c, youtubeModerationStatus: 'heldForReview' })),
        pagination: { page: 1, limit: 25, total: page.length, totalPages: 1 },
      };
    });
    renderCommunity();
    const comment = await firstComment();
    expect(within(comment).queryByRole('button', { name: /Ocultar no YouTube/ })).toBeNull();
    expect((within(comment).getByRole('button', { name: 'Responder' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(comment).getByRole('button', { name: /Republicar no YouTube/ }));
    expect(await screen.findByText('Comentário republicado no YouTube.')).toBeTruthy();
    expect(api.writes()).toEqual([expect.objectContaining({ body: { status: 'published' } })]);
  });

  it('publishes a reply with an idempotency key and closes the form', async () => {
    const api = mockApi();
    renderCommunity();
    await userEvent.click(within(await firstComment()).getByRole('button', { name: 'Responder' }));
    await userEvent.type(screen.getByRole('textbox', { name: /Sua resposta pública/ }), 'Obrigado!');
    await userEvent.click(screen.getByRole('button', { name: /Enviar ao YouTube/ }));

    expect(await screen.findByText('Resposta publicada no YouTube.')).toBeTruthy();
    const [write] = api.writes();
    expect(write.path).toMatch(/community\/comments\/preview-comment-0\/publish-reply$/);
    expect(write.body.text).toBe('Obrigado!');
    expect(write.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.queryByRole('textbox', { name: /Sua resposta pública/ })).toBeNull();
  });

  it('shows the API error message when an action fails', async () => {
    mockApi(call =>
      call.method === 'POST'
        ? { status: 502, body: { error: { code: 'YOUTUBE_API_ERROR', message: 'A quota do YouTube foi esgotada.' } } }
        : undefined,
    );
    renderCommunity();
    await userEvent.click(within(await firstComment()).getByRole('button', { name: /Ocultar no YouTube/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('A quota do YouTube foi esgotada.'));
  });
});
