import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { confirmAction } from '../ConfirmDialog';

const open = (tone: 'danger' | 'default' = 'danger') => {
  let result!: Promise<boolean>;
  act(() => {
    result = confirmAction({
      title: 'Remover este plano?',
      message: 'Não pode ser desfeito.',
      confirmLabel: 'Remover',
      tone,
    });
  });
  return result;
};

describe('confirmAction', () => {
  it('shows a labelled modal with the message and focuses Cancel', async () => {
    void open();
    const dialog = await screen.findByRole('dialog', { name: 'Remover este plano?' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Não pode ser desfeito.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Remover' }).className).toBe('danger-button');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  });

  it('resolves true on confirm and removes itself from the page', async () => {
    const result = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Remover' }));
    await expect(result).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('resolves false on Cancel, Esc and a click on the backdrop', async () => {
    let result = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await expect(result).resolves.toBe(false);

    result = open();
    fireEvent(await screen.findByRole('dialog'), new Event('cancel', { cancelable: true })); // Esc
    await expect(result).resolves.toBe(false);

    result = open();
    fireEvent.click(await screen.findByRole('dialog'));
    await expect(result).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('uses the primary style for non-destructive confirmations', async () => {
    void open('default');
    expect((await screen.findByRole('button', { name: 'Remover' })).className).toBe('primary');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  });
});
