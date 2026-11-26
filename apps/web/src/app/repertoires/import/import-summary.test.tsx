import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../../i18n/catalogue';
import type {
  ImportPreview,
  SkippedGame,
} from '../../../server/import-preview';
import { ImportSummary } from './import-summary';

const i = MESSAGES.repertoires.import;

const PREVIEW: ImportPreview = {
  summary: {
    chapters: 6,
    lines: 13,
    positions: 88,
    transpositions: 1,
    moves: 123,
  },
  chapters: ['Sicilian Defense: Taimanov Variation', 'Chapter 2'],
  renamed: [],
  skipped: [
    { game: 7, reason: 'pgn.illegalMove', moveText: 'Nxe4' },
    { game: 8, reason: 'pgn.secondAnswer', moveText: '5...a6' },
    { game: 9, reason: 'pgn.noMoves', moveText: null },
  ],
  annotations: [],
  target: null,
  refusal: null,
  suggestedSide: null,
  suggestedName: '',
};

/** An existing chapter a merge tells apart from a namesake (R-159). */
const RENAMED = {
  from: 'Caro-Kann Defense',
  to: 'Caro-Kann Defense (B12, 2.\u00A0d4)',
};

function renderSummary(preview: ImportPreview): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ImportSummary preview={preview} busy={false} />
    </NextIntlClientProvider>,
  );
}

describe('ImportSummary', () => {
  it('shows the counts as one line, without positions', () => {
    renderSummary(PREVIEW);
    expect(
      screen.getByRole('heading', { level: 2, name: i.summaryTitle }),
    ).toBeDefined();
    const line = screen.getByText(
      '6 chapters · 13 lines · 123 moves · 1 transposition',
    );
    expect(line.tagName).toBe('P');
    expect(screen.queryByText(/88 positions/)).toBeNull();
  });

  it('writes each count in the singular or plural', () => {
    renderSummary({
      ...PREVIEW,
      summary: {
        chapters: 1,
        lines: 1,
        positions: 3,
        transpositions: 2,
        moves: 1,
      },
    });
    expect(
      screen.getByText('1 chapter · 1 line · 1 move · 2 transpositions'),
    ).toBeDefined();
  });

  it('leaves out transpositions when there are none', () => {
    renderSummary({
      ...PREVIEW,
      summary: { ...PREVIEW.summary, transpositions: 0 },
    });
    expect(screen.getByText('6 chapters · 13 lines · 123 moves')).toBeDefined();
  });

  it('lists the chapters, translating an untitled one', () => {
    renderSummary(PREVIEW);
    const list = screen.getByRole('list', { name: i.chaptersTitle });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Sicilian Defense: Taimanov Variation', 'Chapter 2']);
  });

  it('titles the list as what a merge adds, the stats line being the file’s', () => {
    renderSummary({
      ...PREVIEW,
      target: {
        id: 'r-1',
        name: 'Sicilijos gynyba',
        version: 3,
        added: { chapters: 2, moves: 41, annotated: 0 },
      },
    });
    expect(screen.getByRole('list', { name: i.chaptersAdded })).toBeDefined();
    expect(screen.queryByRole('list', { name: i.chaptersTitle })).toBeNull();
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
    ).toEqual([`“${RENAMED.from}” will be called “${RENAMED.to}”`]);
  });

  it('leaves out the renamed list when no title changes', () => {
    renderSummary(PREVIEW);
    expect(screen.queryByRole('list', { name: i.renamedTitle })).toBeNull();
  });

  it('lists the skipped games with their reason and move', () => {
    renderSummary(PREVIEW);
    const list = screen.getByRole('list', {
      name: 'Skipped games (3)',
    });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Game 7: illegal move, Nxe4',
      'Game 8: a second answer in the same position, 5...a6',
      'Game 9: the game has no moves',
    ]);
  });

  // The server numbers the move (the feature suite holds both sides' forms).
  it('writes the move as the server numbered it', () => {
    renderSummary({
      ...PREVIEW,
      skipped: [{ game: 1, reason: 'pgn.secondAnswer', moveText: '2. Bf4' }],
    });
    expect(
      screen.getByText('Game 1: a second answer in the same position, 2. Bf4'),
    ).toBeDefined();
  });

  it('says every game of the file is valid when none was skipped', () => {
    renderSummary({ ...PREVIEW, skipped: [] });
    // The file's games, as the stats line counts them.
    expect(screen.getByText('All 6 games are valid')).toBeDefined();
    expect(screen.queryByRole('list', { name: /Skipped games/ })).toBeNull();
  });

  it('counts the file’s games, not the ones a merge adds, in the validity line (sign-off)', () => {
    renderSummary({
      ...PREVIEW,
      skipped: [],
      target: {
        id: 'r-1',
        name: 'Sicilijos gynyba',
        version: 3,
        added: { chapters: 2, moves: 41, annotated: 0 },
      },
    });
    expect(screen.getByText('All 6 games are valid')).toBeDefined();
    expect(screen.queryByText('All 2 games are valid')).toBeNull();
  });

  it('leaves out an empty chapter list', () => {
    renderSummary({ ...PREVIEW, chapters: [] });
    expect(screen.queryByRole('list', { name: i.chaptersTitle })).toBeNull();
  });

  it('shows what the file holds and its skipped games when nothing can be added (R-115)', () => {
    renderSummary({
      ...PREVIEW,
      chapters: [],
      skipped: [{ game: 1, reason: 'pgn.secondAnswer', moveText: '2...d6' }],
      refusal: 'pgn.nothingToAdd',
    });
    expect(
      screen.getByText('6 chapters · 13 lines · 123 moves · 1 transposition'),
    ).toBeDefined();
    expect(screen.queryByRole('list', { name: i.chaptersTitle })).toBeNull();
    expect(
      screen.getByText('Game 1: a second answer in the same position, 2...d6'),
    ).toBeDefined();
  });

  it('says nothing about valid games when nothing can be added (R-115)', () => {
    renderSummary({
      ...PREVIEW,
      chapters: [],
      skipped: [],
      refusal: 'pgn.nothingToAdd',
    });
    expect(screen.queryByText(/games are valid/)).toBeNull();
  });

  it('shows the first 10 skipped games and the rest on request', () => {
    const skipped: SkippedGame[] = Array.from({ length: 12 }, (_, n) => ({
      game: n + 1,
      reason: 'pgn.unreadable',
      moveText: null,
    }));
    renderSummary({ ...PREVIEW, skipped });
    const items = () =>
      within(
        screen.getByRole('list', { name: 'Skipped games (12)' }),
      ).getAllByRole('listitem');
    expect(items()).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 12' }));
    expect(items()).toHaveLength(12);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('marks itself busy while the preview re-runs', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <ImportSummary preview={PREVIEW} busy />
      </NextIntlClientProvider>,
    );
    expect(
      screen
        .getByRole('heading', { name: i.summaryTitle })
        .closest('section')
        ?.getAttribute('aria-busy'),
    ).toBe('true');
  });

  it('speaks of symbols, not PGN NAGs (#335)', () => {
    const { annotationsTitle, addedAnnotations } = MESSAGES.repertoires.import;
    expect(`${annotationsTitle} ${addedAnnotations}`).not.toMatch(/NAG/);
    expect(MESSAGES.repertoires.import.annotationsTitle).toContain('symbols');
  });

  it('lists the comments and NAGs a merge adds to moves already there (R-175, R-176)', () => {
    renderSummary({
      ...PREVIEW,
      annotations: [
        { move: '8. Qxc4!', comment: null },
        { move: '18. e4!', comment: 'Centras' },
      ],
    });
    const list = screen.getByRole('list', {
      name: i.annotationsTitle.replace('{count}', '2'),
    });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['8. Qxc4!', '18. e4!: Centras']);
  });

  it('shows the first ten added comments, and the rest on request', () => {
    const annotations = Array.from({ length: 12 }, (_, n) => ({
      move: `${String(n + 1)}. d4`,
      comment: `Note ${String(n + 1)}`,
    }));
    renderSummary({ ...PREVIEW, annotations });
    const items = () =>
      within(
        screen.getByRole('list', {
          name: i.annotationsTitle.replace('{count}', '12'),
        }),
      ).getAllByRole('listitem');
    expect(items()).toHaveLength(10);
    fireEvent.click(
      screen.getByRole('button', {
        name: i.annotationsAll.replace('{count}', '12'),
      }),
    );
    expect(items()).toHaveLength(12);
  });

  it('lists no added comments when the merge adds none', () => {
    renderSummary(PREVIEW);
    expect(
      screen.queryByRole('list', {
        name: i.annotationsTitle.replace('{count}', '0'),
      }),
    ).toBeNull();
  });
});

describe('ImportSummary side check (#364, R-214)', () => {
  const SUGGESTS_WHITE: ImportPreview = { ...PREVIEW, suggestedSide: 'white' };

  it('says the file looks like the other side’s, with a switch to it', () => {
    const switched: string[] = [];
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <ImportSummary
          preview={SUGGESTS_WHITE}
          busy={false}
          onSwitchSide={(side) => switched.push(side)}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText(
        'Most games were skipped as second answers. Did you mean White?',
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Preview as White' }));
    expect(switched).toEqual(['white']);
  });

  it('warns with no switch when there is none to offer', () => {
    renderSummary(SUGGESTS_WHITE);
    expect(screen.getByText(/Did you mean White?/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Preview as/ })).toBeNull();
  });

  it('says nothing of the side when it fits', () => {
    renderSummary(PREVIEW);
    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });
});
