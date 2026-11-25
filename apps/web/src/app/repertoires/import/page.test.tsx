import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/catalogue';
import ImportPage from './page';

// requireOnboarded, inside myRepertoires, never returns for a signed-out or
// new account; the feature suite covers that.
vi.mock('../../../server/repertoires', () => ({
  myRepertoires: () =>
    Promise.resolve([
      {
        id: 'r-white',
        side: 'white',
        name: 'Londono sistema',
        chapters: 2,
        moves: 21,
        updatedAt: new Date('2026-10-18T08:00:00Z'),
      },
    ]),
}));

// The session account and its Lichess link, the names the side default
// looks for in a file's players (#330 decision 8).
const session = vi.hoisted(() => {
  const state: { lichess: string | null } = { lichess: null };
  return state;
});

vi.mock('../../../server/session', () => ({
  requireOnboarded: () => Promise.resolve({ id: 'a1', displayName: 'Rokas' }),
}));

vi.mock('../../../server/provider-links', () => ({
  lichessUsername: () => Promise.resolve(session.lichess),
}));

vi.mock('./actions', () => ({
  previewImportAction: vi.fn(),
  confirmImportAction: vi.fn(),
}));

const i = MESSAGES.repertoires.import;
const c = MESSAGES.repertoires.create;

async function renderPage(params: Record<string, string> = {}): Promise<void> {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {await ImportPage({ searchParams: Promise.resolve(params) })}
    </NextIntlClientProvider>,
  );
}

const radio = (name: string): HTMLInputElement =>
  screen.getByRole<HTMLInputElement>('radio', { name });

describe('the import page', () => {
  it('shows the title, the limits, the way back and the file step', async () => {
    await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: i.title }),
    ).toBeDefined();
    expect(screen.getByText(i.intro)).toBeDefined();
    expect(
      screen.getByRole('link', { name: i.back }).getAttribute('href'),
    ).toBe('/repertoires');
    const file = screen.getByLabelText<HTMLInputElement>(i.file);
    expect(file.type).toBe('file');
    expect(file.accept).toBe('.pgn,application/x-chess-pgn,text/plain');
    expect(radio(c.white).checked).toBe(true);
    expect(radio(c.black).disabled).toBe(false);
  });

  it('fixes the side of the repertoire it was opened from', async () => {
    await renderPage({ i: 'r-white' });
    expect(radio(c.white).checked).toBe(true);
    expect(radio(c.black).disabled).toBe(true);
  });

  it('ignores an id that is not one of the account’s repertoires', async () => {
    await renderPage({ i: 'someone-elses' });
    expect(radio(c.black).disabled).toBe(false);
  });

  it('offers a field to paste PGN in', async () => {
    await renderPage();
    expect(screen.getByLabelText(i.paste).tagName).toBe('TEXTAREA');
  });

  it('defaults the side from the display name (#330 decision 8)', async () => {
    session.lichess = null;
    await renderPage();
    fireEvent.change(screen.getByLabelText(i.paste), {
      target: { value: '[White "X"]\n[Black "Rokas"]\n\n1. e4 c5 *\n' },
    });
    // Read once typing pauses.
    await waitFor(() => {
      expect(radio(c.black).checked).toBe(true);
    });
  });

  it('defaults the side from the linked Lichess username too', async () => {
    session.lichess = 'rokas_lt';
    await renderPage();
    fireEvent.change(screen.getByLabelText(i.paste), {
      target: { value: '[White "X"]\n[Black "Rokas_LT"]\n\n1. e4 c5 *\n' },
    });
    await waitFor(() => {
      expect(radio(c.black).checked).toBe(true);
    });
  });
});
