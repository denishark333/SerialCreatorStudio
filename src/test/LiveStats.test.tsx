import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TwitchRevenue } from '../overview/TwitchRevenue';
import { LiveSessions } from '../overview/LiveSessions';
import { StreamAnalytics } from '../StreamAnalytics';
import { mockApi } from './api';

const item = (values: unknown, subsUsd: number | null) => ({
  channelId: 'tw',
  name: 'Canal',
  month: '2026-11',
  subs: { tier1: 10, tier2: 1, tier3: 0, gifted: 3, total: 11, complete: true },
  bits: 1500,
  values,
  prime: { estimated: 4, share: 0.4, samples: 5 },
  estimate: { subs: subsUsd, bits: 15, total: (subsUsd ?? 0) + 15, currency: 'USD' },
  monthEvents: { subs: 0, resubs: 0, gifts: 0, bits: 0 },
  missing: ['chat'],
  observedAt: null,
});

describe('Live statistics', () => {
  it('estimates the month from bits, asks for the value per tier and saves it', async () => {
    let saved = false;
    const api = mockApi(call => {
      if (call.path.endsWith('/streams/revenue'))
        return {
          data: {
            month: '2026-11',
            bitValue: 0.01,
            items: [saved ? item({ tier1: 1.2, tier2: 2.5, tier3: null, prime: 0.8 }, 14.5) : item(null, null)],
          },
        };
      if (call.path.endsWith('/revenue-settings')) {
        saved = true;
        return { data: call.body };
      }
      return undefined;
    });
    render(<TwitchRevenue channelIds={['tw']} revision={0} />);
    expect(await screen.findByText('1,5 mil bits no mês')).toBeTruthy();
    expect(screen.getByText('~4 dos T1 são Prime (40% de 5 anúncios)')).toBeTruthy();
    expect(screen.getByText(/Para registrar o chat, reconecte a Twitch/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Definir valores' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Tier 1' }), '1,20');
    await userEvent.type(screen.getByRole('textbox', { name: 'Tier 2' }), '2.5');
    await userEvent.type(screen.getByRole('textbox', { name: 'Prime Gaming' }), '0,80');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar valores' }));
    await waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({ method: 'PATCH', body: { tier1: 1.2, tier2: 2.5, tier3: null, prime: 0.8 } }),
      ]),
    );
    expect(await screen.findByText(/14,50/)).toBeTruthy();
  });

  it('lists the lives of the period with raids and chat', async () => {
    mockApi(call =>
      call.path.endsWith('/streams/sessions')
        ? {
            data: [
              {
                id: 's1',
                channelId: 'tw',
                platform: 'Twitch',
                title: 'DOMINGOU!',
                game: 'Aion 2',
                startedAt: '2026-11-01T21:07:00Z',
                date: '2026-11-01',
                time: '18:07',
                live: false,
                minutes: 245,
                samples: 9,
                avgViewers: 26,
                peakViewers: 41,
                minutesWatched: 6370,
                followersGained: 7,
                subs: 2,
                resubs: 3,
                gifts: 5,
                bits: 300,
                raids: [{ from: 'jhoolna', fromLogin: 'jhoolna', viewers: 42, at: '' }],
                chat: { messages: 812, chatters: 34 },
                tracking: { events: true, chat: true },
              },
            ],
          }
        : undefined,
    );
    render(<LiveSessions platform="Twitch" channelIds={['tw']} from="2026-10-19" to="2026-11-17" revision={0} />);
    expect(await screen.findByText('DOMINGOU!')).toBeTruthy();
    expect(screen.getByText('Aion 2 · 4h05')).toBeTruthy();
    expect(screen.getByText('+7')).toBeTruthy();
    expect(screen.getByTitle('34 participantes únicos · 812 mensagens').textContent).toBe('34');
    expect(screen.getByText(/Raid de/).textContent).toContain('jhoolna (42)');
  });

  it('analytics: YouTube-style tabs with raids, games, top lives and engagement; Kick hides Twitch-only data', async () => {
    const session = {
      id: 's1',
      channelId: 'tw',
      platform: 'Twitch',
      title: 'DOMINGOU!',
      game: 'Aion 2',
      startedAt: '2026-11-01T21:00:00Z',
      date: '2026-11-01',
      time: '18:00',
      live: false,
      minutes: 125,
      samples: 5,
      avgViewers: 26,
      peakViewers: 41,
      minutesWatched: 3250,
      followersGained: 7,
      subs: 2,
      resubs: 0,
      gifts: 1,
      bits: 300,
      raids: [],
      chat: { messages: 400, chatters: 34 },
      tracking: { events: true, chat: true },
      thumbnailUrl: null,
    };
    const report = {
      from: '2026-11-01',
      to: '2026-11-02',
      dataSince: '2026-11-01',
      totals: {
        lives: 1,
        minutes: 125,
        avgViewers: 26,
        peakViewers: 41,
        minutesWatched: 3250,
        followers: 7,
        subs: 3,
        bits: 300,
        chatters: 34,
        raids: 1,
        raidViewers: 42,
      },
      days: [
        {
          date: '2026-11-01',
          lives: 1,
          minutes: 125,
          avgViewers: 26,
          peakViewers: 41,
          minutesWatched: 3250,
          followers: 7,
          subs: 3,
          bits: 300,
          chatters: 34,
          raids: 1,
        },
      ],
      games: [{ game: 'Aion 2', lives: 1, minutes: 125, avgViewers: 26 }],
      raiders: [{ name: 'jhoolna', login: 'jhoolna', raids: 1, viewers: 42 }],
      sessions: [session],
      coverage: [
        { channelId: 'tw', name: 'Canal', status: 'available', reason: 'ok', fetchedAt: null, since: '2026-11-01' },
      ],
      tracking: { events: true, chat: true },
    };
    mockApi(call => (call.path.endsWith('/streams/analytics') ? { data: report } : undefined));
    const { unmount } = render(
      <StreamAnalytics platform="Twitch" channelIds={['tw']} from="2026-11-01" to="2026-11-02" revision={0} />,
    );
    expect(await screen.findByRole('heading', { name: 'De onde chegam' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'jhoolna' }).getAttribute('href')).toBe('https://www.twitch.tv/jhoolna');
    expect(screen.getByText('dias com live')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Alcance' }));
    expect(screen.getByRole('heading', { name: 'Lives com maior alcance' })).toBeTruthy();
    expect(screen.getByText('DOMINGOU!')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Engajamento' }));
    expect(screen.getByRole('button', { name: 'Bits' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Lives que mais engajaram' })).toBeTruthy();
    unmount();
    render(<StreamAnalytics platform="Kick" channelIds={['kk']} from="2026-11-01" to="2026-11-02" revision={0} />);
    expect(await screen.findByText('A API da Kick não informa raids.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Engajamento' }));
    expect(screen.queryByRole('button', { name: 'Bits' })).toBeNull();
  });
});
