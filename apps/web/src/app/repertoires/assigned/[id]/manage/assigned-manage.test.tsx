import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../../i18n/catalogue';
import type { ForkState, PauseState } from '../actions';
import { AssignedManage } from './assigned-manage';

const server = vi.hoisted(() => ({
  pause: vi.fn<(previous: PauseState, form: FormData) => Promise<PauseState>>(),
  fork: vi.fn<(previous: ForkState, form: FormData) => Promise<ForkState>>(),
}));

vi.mock('../actions', () => ({ pauseAction: server.pause }));

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const a = MESSAGES.assignment;
const m = a.manage;

function renderScreen({
  paused = false,
  forkOpen = false,
}: { paused?: boolean; forkOpen?: boolean } = {}): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <AssignedManage
        repertoire={{ id: ID, name: 'Londono sistema' }}
        paused={paused}
        forkAction={server.fork}
        forkOpen={forkOpen}
      />
    </NextIntlClientProvider>,
  );
}

const section = (name: string): HTMLElement =>
  screen.getByRole('region', { name });

beforeEach(() => {
  server.pause
    .mockReset()
    .mockImplementation((_previous, form) =>
      Promise.resolve({ paused: form.get('paused') === 'true' }),
    );
  server.fork.mockReset().mockResolvedValue({});
});

describe('the assigned Repertoire screen (R-226)', () => {
  it('is titled by the repertoire, with the way back to it', () => {
    renderScreen();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: 'Back to Londono sistema' })
        .getAttribute('href'),
    ).toBe(`/repertoires/assigned/${ID}`);
  });

  it('has pause, download and own copy, each saying what it does', () => {
    renderScreen();
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      a.pause.pause,
      MESSAGES.repertoires.header.download,
      a.fork.label,
    ]);
    expect(
      within(section(a.pause.pause)).getByText(m.pauseIntro),
    ).toBeDefined();
    const download = section(MESSAGES.repertoires.header.download);
    expect(within(download).getByText(m.downloadIntro)).toBeDefined();
    const link = within(download).getByRole('link', {
      name: MESSAGES.repertoires.header.download,
    });
    expect(link.getAttribute('href')).toBe(`/api/repertoires/${ID}/export`);
    expect(link.hasAttribute('download')).toBe(true);
    expect(within(section(a.fork.label)).getByText(m.forkIntro)).toBeDefined();
  });

  it('pauses, then offers Resume (R-46)', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: a.pause.pause }));
    expect(
      await screen.findByRole('button', { name: a.pause.resume }),
    ).toBeDefined();
    expect(server.pause.mock.lastCall?.[1].get('paused')).toBe('true');
    expect(screen.getByText(a.pause.pausedHint)).toBeDefined();
  });

  it('offers Resume on a paused assignment', () => {
    renderScreen({ paused: true });
    expect(screen.getByRole('button', { name: a.pause.resume })).toBeDefined();
  });

  it('asks before making the copy (R-20, R-128)', async () => {
    renderScreen();
    const fork = section(a.fork.label);
    expect(within(fork).queryByText(/Make your own copy of/)).toBeNull();
    fireEvent.click(within(fork).getByRole('button', { name: a.fork.label }));
    expect(
      within(fork).getByText(
        a.fork.question.replace('{name}', 'Londono sistema'),
      ),
    ).toBeDefined();
    fireEvent.click(within(fork).getByRole('button', { name: a.fork.confirm }));
    await waitFor(() => {
      expect(server.fork.mock.lastCall?.[1].get('repertoireId')).toBe(ID);
    });
  });

  it('opens with the copy’s question when asked to (?fork=1)', () => {
    renderScreen({ forkOpen: true });
    expect(
      within(section(a.fork.label)).getByText(
        a.fork.question.replace('{name}', 'Londono sistema'),
      ),
    ).toBeDefined();
  });
});
