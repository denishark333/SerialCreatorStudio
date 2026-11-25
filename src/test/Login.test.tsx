import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login } from '../Login';
import { apiSession, restoreSession } from '../apiSession';
import { mockApi } from './api';

const google = () => screen.getByRole('button', { name: 'Continuar com Google / YouTube' });

describe('Login', () => {
  it('requires accepting the terms before any platform login', async () => {
    mockApi();
    render(<Login onLogin={() => {}} />);
    expect((google() as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox'));
    expect((google() as HTMLButtonElement).disabled).toBe(false);
  });

  it('signs in through the platform tab and keeps the session for reloads', async () => {
    const api = mockApi();
    const tab = { opener: {}, close: vi.fn(), location: { replace: vi.fn() } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const onLogin = vi.fn();
    render(<Login onLogin={onLogin} />);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(google());

    await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.opener).toBeNull();
    expect(tab.location.replace).toHaveBeenCalledWith('https://preview.invalid/');
    const start = api.calls.find(c => c.path.endsWith('/auth/login/google'))!;
    expect(start.body).toEqual({ privacyVersion: expect.any(String), termsVersion: expect.any(String) });
    expect(apiSession.workspaceId).toBe('preview-studio');

    // Simulated reload: memory is reset, the tab's sessionStorage restores the login.
    Object.assign(apiSession, { token: '', workspaceId: 'studio-live', expiresAt: 0, primaryChannelId: null });
    expect(restoreSession()).toBe(true);
    expect(apiSession.token).toBe('preview-not-a-real-token');
  });

  it('explains when the browser blocks the login tab', async () => {
    mockApi();
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Login onLogin={() => {}} />);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(google());
    expect(await screen.findByText('Permita novas abas para entrar com sua plataforma.')).toBeTruthy();
  });
});
