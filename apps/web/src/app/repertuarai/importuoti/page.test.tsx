import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
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

vi.mock('./actions', () => ({
  previewImportAction: vi.fn(),
  confirmImportAction: vi.fn(),
}));

const i = MESSAGES.lt.repertoires.import;
const c = MESSAGES.lt.repertoires.create;

async function renderPage(params: Record<string, string> = {}): Promise<void> {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
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
    ).toBe('/repertuarai');
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
});
