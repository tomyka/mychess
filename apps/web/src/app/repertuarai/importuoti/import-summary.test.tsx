import type { Skipped } from '@mychess/chess';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
import type { ImportPreview } from '../../../server/import-preview';
import { ImportSummary } from './import-summary';

const i = MESSAGES.lt.repertoires.import;

const PREVIEW: ImportPreview = {
  summary: {
    chapters: 6,
    lines: 7,
    positions: 88,
    transpositions: 3,
    moves: 1,
  },
  chapters: [
    { kind: 'text', text: 'Sicilijos gynyba, Taimanovo variantas' },
    { kind: 'key', key: 'chapter.untitled', number: 2 },
  ],
  skipped: [
    { game: 7, reason: 'pgn.illegalMove', san: 'Nxe4' },
    { game: 8, reason: 'pgn.secondAnswer', san: 'a6', move: 5 },
    { game: 9, reason: 'pgn.noMoves' },
  ],
  target: null,
};

function renderSummary(
  preview: ImportPreview,
  side: 'white' | 'black' = 'black',
): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <ImportSummary preview={preview} side={side} busy={false} />
    </NextIntlClientProvider>,
  );
}

describe('ImportSummary', () => {
  it('shows the five counts, each as one text run', () => {
    renderSummary(PREVIEW);
    expect(
      screen.getByRole('heading', { level: 2, name: i.summaryTitle }),
    ).toBeDefined();
    for (const text of [
      '6 skyriai',
      '7 variantai',
      '88 pozicijos',
      '3 perstatos',
      '1 ėjimas',
    ]) {
      expect(screen.getByText(text)).toBeDefined();
    }
  });

  it('lists the chapters, translating an untitled one', () => {
    renderSummary(PREVIEW);
    const list = screen.getByRole('list', { name: i.chaptersTitle });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Sicilijos gynyba, Taimanovo variantas', '2 skyrius']);
  });

  it('lists the skipped games with their reason and move', () => {
    renderSummary(PREVIEW);
    const list = screen.getByRole('list', {
      name: 'Praleistos partijos (3)',
    });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '7 partija: neleistinas ėjimas, Nxe4',
      '8 partija: antras atsakymas toje pačioje pozicijoje, 5...a6',
      '9 partija: partijoje nėra ėjimų',
    ]);
  });

  it('writes a White answer with one dot', () => {
    renderSummary(
      {
        ...PREVIEW,
        skipped: [{ game: 1, reason: 'pgn.secondAnswer', san: 'Bf4', move: 2 }],
      },
      'white',
    );
    expect(
      screen.getByText(
        '1 partija: antras atsakymas toje pačioje pozicijoje, 2. Bf4',
      ),
    ).toBeDefined();
  });

  it('says every game is valid when none was skipped', () => {
    renderSummary({ ...PREVIEW, skipped: [] });
    expect(screen.getByText('Visos 2 partijos tinkamos')).toBeDefined();
    expect(screen.queryByRole('list', { name: /Praleistos/ })).toBeNull();
  });

  it('shows the first 10 skipped games and the rest on request', () => {
    const skipped: Skipped[] = Array.from({ length: 12 }, (_, n) => ({
      game: n + 1,
      reason: 'pgn.unreadable',
    }));
    renderSummary({ ...PREVIEW, skipped });
    const items = () =>
      within(
        screen.getByRole('list', { name: 'Praleistos partijos (12)' }),
      ).getAllByRole('listitem');
    expect(items()).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Rodyti visas (12)' }));
    expect(items()).toHaveLength(12);
    expect(screen.queryByRole('button', { name: /Rodyti visas/ })).toBeNull();
  });

  it('marks itself busy while the preview re-runs', () => {
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        <ImportSummary preview={PREVIEW} side="black" busy />
      </NextIntlClientProvider>,
    );
    expect(
      screen
        .getByRole('heading', { name: i.summaryTitle })
        .closest('section')
        ?.getAttribute('aria-busy'),
    ).toBe('true');
  });
});
