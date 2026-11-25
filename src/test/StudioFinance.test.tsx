import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudioFinance } from '../StudioFinance';
import { answerConfirm, channel, forbidNativeConfirm, mockApi } from './api';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const deals = [
  {
    id: 'd1',
    channelId: channel.id,
    title: 'Marca A',
    type: 'deal',
    amountCents: 150000,
    currency: 'BRL',
    date: '2026-11-10',
    stage: 'Proposta',
    source: 'manual',
  },
  {
    id: 'd2',
    channelId: channel.id,
    title: 'Marca B',
    type: 'deal',
    amountCents: 25000,
    currency: 'USD',
    date: '2026-11-11',
    stage: 'Proposta',
    source: 'manual',
  },
];
const page = (data: unknown[]) => ({ data, pagination: { page: 1, limit: 100, total: data.length, totalPages: 1 } });

const renderFinance = () =>
  render(<StudioFinance channels={[channel]} channelId="" from="2026-10-18" to="2026-11-16" revenue={null} />);

describe('StudioFinance', () => {
  it('registers a manual payout; the amount mask follows the selected currency', async () => {
    const api = mockApi(call => (call.path.endsWith('/financial/payouts') ? page([]) : undefined));
    renderFinance();
    await userEvent.click(screen.getByRole('button', { name: 'Pagamentos' }));
    await userEvent.click(await screen.findByRole('button', { name: /Registrar pagamento/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Descrição' }), 'AdSense outubro');
    const amount = screen.getByRole('textbox', { name: 'Valor' }) as HTMLInputElement;
    await userEvent.type(amount, '123456');
    expect(amount.value).toBe('1.234,56');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Moeda' }), 'USD');
    expect(amount.value).toBe('1,234.56');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar registro' }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({
      type: 'payout',
      title: 'AdSense outubro',
      channelId: channel.id,
      amount: 1234.56,
      currency: 'USD',
      date: '2026-11-16',
      stage: 'Previsto',
    });
  });

  it('formats while typing: digits fill from the right, separators are automatic, other keys are ignored', async () => {
    mockApi(call => (call.path.endsWith('/financial/payouts') ? page([]) : undefined));
    renderFinance();
    await userEvent.click(screen.getByRole('button', { name: 'Pagamentos' }));
    await userEvent.click(await screen.findByRole('button', { name: /Registrar pagamento/ }));
    const amount = screen.getByRole('textbox', { name: 'Valor' }) as HTMLInputElement;
    expect(amount.placeholder).toBe('0,00');
    await userEvent.type(amount, '1');
    expect(amount.value).toBe('0,01');
    await userEvent.type(amount, '000000');
    expect(amount.value).toBe('10.000,00');
    await userEvent.type(amount, 'a.,-');
    expect(amount.value).toBe('10.000,00');
    await userEvent.type(amount, '{Backspace}');
    expect(amount.value).toBe('1.000,00');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Moeda' }), 'USD');
    expect(amount.value).toBe('1,000.00');
    expect(amount.placeholder).toBe('0.00');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Moeda' }), 'EUR');
    expect(amount.value).toBe('1.000,00');
  });

  it('accepts browser autofill and pasted values in the currency format', async () => {
    const api = mockApi(call => (call.path.endsWith('/financial/deals') ? page([]) : undefined));
    renderFinance();
    await userEvent.click(screen.getByRole('button', { name: 'Parcerias' }));
    await userEvent.click(await screen.findByRole('button', { name: /Nova parceria/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Marca / parceria' }), 'Marca C');
    // Autofill/paste set the whole value at once (not a keystroke).
    const amount = screen.getByRole('textbox', { name: 'Valor' }) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '40,00' } });
    expect(amount.value).toBe('40,00');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Moeda' }), 'USD');
    fireEvent.change(amount, { target: { value: '1,500.5' } });
    expect(amount.value).toBe('1,500.50');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar registro' }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual(
      expect.objectContaining({ type: 'deal', title: 'Marca C', amount: 1500.5, currency: 'USD' }),
    );
  });

  it('gives a deal its delivery window and keywords, and edits them on the card', async () => {
    const api = mockApi(call => (call.path.endsWith('/financial/deals') ? page(deals) : undefined));
    renderFinance();
    await userEvent.click(screen.getByRole('button', { name: 'Parcerias' }));
    await userEvent.click(await screen.findByRole('button', { name: /Nova parceria/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Marca / parceria' }), 'Marca C');
    fireEvent.change(screen.getByRole('textbox', { name: 'Valor' }), { target: { value: '100,00' } });
    fireEvent.change(screen.getByLabelText(/Fim da entrega/), { target: { value: '2026-11-23' } });
    await userEvent.type(screen.getByRole('textbox', { name: /Palavras-chave/ }), 'marca c, #publi, , #publi');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar registro' }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual(
      expect.objectContaining({ title: 'Marca C', endDate: '2026-11-23', keywords: ['marca c', '#publi'] }),
    );

    const card = (await screen.findByRole('heading', { name: 'Marca A' })).closest('article')!;
    expect(within(card as HTMLElement).getByText(/Sem palavras-chave/)).toBeTruthy();
    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: /Editar entrega/ }));
    await userEvent.type(within(card as HTMLElement).getByRole('textbox', { name: 'Palavras-chave' }), 'aion 2');
    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.writes()).toHaveLength(2));
    expect(api.writes()[1]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        path: expect.stringMatching(/financial\/d1$/),
        body: { endDate: null, keywords: ['aion 2'] },
      }),
    );
  });

  it('does not submit without an amount', async () => {
    const api = mockApi(call => (call.path.endsWith('/financial/payouts') ? page([]) : undefined));
    renderFinance();
    await userEvent.click(screen.getByRole('button', { name: 'Pagamentos' }));
    await userEvent.click(await screen.findByRole('button', { name: /Registrar pagamento/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Descrição' }), 'Teste');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar registro' }));
    expect(api.writes()).toHaveLength(0);
    expect((screen.getByRole('textbox', { name: 'Valor' }) as HTMLInputElement).validity.valueMissing).toBe(true);
  });

  it('never sums different currencies in the deal pipeline', async () => {
    mockApi(call => (call.path.endsWith('/financial/deals') ? page(deals) : undefined));
    renderFinance();
    await userEvent.click(screen.getByRole('button', { name: 'Parcerias' }));
    const column = (await screen.findByRole('heading', { name: /Proposta/, level: 3 })).closest('section')!;
    await within(column as HTMLElement).findByRole('heading', { name: 'Marca B' });
    const total = column.querySelector('.deal-column-title strong')!.textContent!;
    expect(total).toMatch(/R\$\s?1\.500,00/);
    expect(total).toMatch(/US\$\s?250,00/);
  });

  it('moves a deal to another stage and removes a record', async () => {
    const api = mockApi(call => {
      if (call.path.endsWith('/financial/deals')) return page(deals);
      if (call.method === 'DELETE') return { status: 204 };
      return undefined;
    });
    renderFinance();
    await userEvent.click(screen.getByRole('button', { name: 'Parcerias' }));
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Etapa da parceria Marca A' }),
      'Confirmado',
    );
    await waitFor(() =>
      expect(api.writes()[0]).toEqual(
        expect.objectContaining({
          method: 'PATCH',
          path: expect.stringMatching(/financial\/d1$/),
          body: { stage: 'Confirmado' },
        }),
      ),
    );
    forbidNativeConfirm();
    const card = screen.getByRole('heading', { name: 'Marca B' }).closest('article')!;
    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: /Remover registro/ }));
    await answerConfirm('Remover este registro?', 'confirm');
    await waitFor(() =>
      expect(api.writes()[1]).toEqual(
        expect.objectContaining({ method: 'DELETE', path: expect.stringMatching(/financial\/d2$/) }),
      ),
    );
  });

  it('keeps a deal when the removal is not confirmed', async () => {
    const api = mockApi(call => (call.path.endsWith('/financial/deals') ? page(deals) : undefined));
    forbidNativeConfirm();
    renderFinance();
    await userEvent.click(screen.getByRole('button', { name: 'Parcerias' }));
    const card = (await screen.findByRole('heading', { name: 'Marca A' })).closest('article')!;
    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: /Remover registro/ }));
    await answerConfirm('Remover este registro?', 'cancel');
    expect(api.writes()).toHaveLength(0);
  });

  it('keeps a payout when the removal is not confirmed, deletes it when confirmed', async () => {
    const payout = { ...deals[0], id: 'p1', title: 'AdSense setembro', type: 'payout', stage: 'Recebido' };
    const api = mockApi(call => {
      if (call.path.endsWith('/financial/payouts')) return page([payout]);
      if (call.method === 'DELETE') return { status: 204 };
      return undefined;
    });
    forbidNativeConfirm();
    renderFinance();
    await userEvent.click(screen.getByRole('button', { name: 'Pagamentos' }));
    const removeButton = await screen.findByRole('button', { name: 'Remover AdSense setembro' });
    await userEvent.click(removeButton);
    await answerConfirm('Remover este registro?', 'cancel');
    expect(api.writes()).toHaveLength(0);

    await userEvent.click(removeButton);
    await answerConfirm('Remover este registro?', 'confirm');
    await waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({ method: 'DELETE', path: expect.stringMatching(/financial\/p1$/) }),
      ]),
    );
  });
});
