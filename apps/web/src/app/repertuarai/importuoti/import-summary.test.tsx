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
  chapters: ['Sicilijos gynyba, Taimanovo variantas', 'Skyrius 2'],
  renamed: [],
  skipped: [
    { game: 7, reason: 'pgn.illegalMove', san: 'Nxe4' },
    { game: 8, reason: 'pgn.secondAnswer', san: 'a6', move: 5 },
    { game: 9, reason: 'pgn.noMoves' },
  ],
  target: null,
  refusal: null,
};

/** An existing chapter a merge tells apart from a namesake (R-159). */
const RENAMED = {
  from: 'Karo-Kano gynyba',
  to: 'Karo-Kano gynyba (B12, 2.\u00A0d4)',
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
      '88 padėtys',
      '3 ėjimų perstatymai',
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
    ).toEqual(['Sicilijos gynyba, Taimanovo variantas', 'Skyrius 2']);
  });

  it('lists the existing chapters a merge renames, old title and new (R-159)', () => {
    renderSummary({
      ...PREVIEW,
      renamed: [RENAMED],
    });
    const list = screen.getByRole('list', { name: i.renamedTitle });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      `\u201e${RENAMED.from}\u201c vadinsis \u201e${RENAMED.to}\u201c`,
    ]);
  });

  it('leaves out the renamed list when no title changes', () => {
    renderSummary(PREVIEW);
    expect(screen.queryByRole('list', { name: i.renamedTitle })).toBeNull();
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
      'Partija 7: neleistinas ėjimas, Nxe4',
      'Partija 8: antras atsakymas toje pačioje padėtyje, 5...a6',
      'Partija 9: partijoje nėra ėjimų',
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
        'Partija 1: antras atsakymas toje pačioje padėtyje, 2. Bf4',
      ),
    ).toBeDefined();
  });

  it('says every game is valid when none was skipped', () => {
    renderSummary({ ...PREVIEW, skipped: [] });
    expect(screen.getByText('Visos partijos tinkamos (2)')).toBeDefined();
    expect(screen.queryByRole('list', { name: /Praleistos/ })).toBeNull();
  });

  it('leaves out an empty chapter list', () => {
    renderSummary({ ...PREVIEW, chapters: [] });
    expect(screen.queryByRole('list', { name: i.chaptersTitle })).toBeNull();
  });

  it('shows only the skipped games when nothing can be added (R-115)', () => {
    renderSummary({
      ...PREVIEW,
      chapters: [],
      skipped: [{ game: 1, reason: 'pgn.secondAnswer', san: 'd6', move: 2 }],
      refusal: 'pgn.nothingToAdd',
    });
    expect(screen.queryByText('6 skyriai')).toBeNull();
    expect(screen.queryByRole('list', { name: i.chaptersTitle })).toBeNull();
    expect(
      screen.getByText(
        'Partija 1: antras atsakymas toje pačioje padėtyje, 2...d6',
      ),
    ).toBeDefined();
  });

  it('says nothing about valid games when nothing can be added (R-115)', () => {
    renderSummary({
      ...PREVIEW,
      chapters: [],
      skipped: [],
      refusal: 'pgn.nothingToAdd',
    });
    expect(screen.queryByText(/Visos partijos tinkamos/)).toBeNull();
    expect(screen.queryByText('6 skyriai')).toBeNull();
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
