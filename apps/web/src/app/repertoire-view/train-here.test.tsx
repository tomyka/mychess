import { lines, moveKey, type RepertoireMove } from '@mychess/chess';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, TAIMANOV } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import type { KnowCounts, KnowOutcome } from '../repertoires/know-actions';
import { currentLineIndex } from './current-line';
import { panelTraining } from './test-training';
import { knowChoices, TrainHere } from './train-here';

const server = vi.hoisted(() => ({
  count: vi.fn<(form: FormData) => Promise<KnowCounts>>(),
  mark: vi.fn<(form: FormData) => Promise<KnowOutcome>>(),
  again: vi.fn<(form: FormData) => Promise<KnowOutcome>>(),
}));

vi.mock('../repertoires/know-actions', () => ({
  knowCountAction: server.count,
  markKnownAction: server.mark,
  learnAgainAction: server.again,
}));

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const know = MESSAGES.training.know;
const taimanov = graphOf(TAIMANOV, 'black');
const CHAPTER = 'c1';
const [mainLine = []] = lines(taimanov, CHAPTER);
/** 1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 Qc7: Black's own move. */
const AT_QC7 = mainLine.slice(0, 10);
/** ... 5. Nc3: White's, the opponent's. */
const AT_NC3 = mainLine.slice(0, 9);
const QC7 = AT_QC7.at(-1);
/** The main line's own moves: c5 e6 cxd4 Nc6 Qc7 a6 Nf6. */
const LINE_NAME = 'This line, 7 moves';
/** And those of the variations: a6 after 6. Be2, Nf6 twice there, a6 after 6. g3. */
const CHAPTER_NAME = 'This chapter, 11 moves';

const counts = (k: number, again: number): KnowCounts => ({
  ok: true,
  know: k,
  again,
});

function renderHere(
  path: readonly RepertoireMove[],
  { learnedToday = 0 }: { learnedToday?: number } = {},
): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <TrainHere
        training={panelTraining({
          repertoireId: ID,
          learn: {
            tracked: [],
            learnedToday,
            limits: { reviews: 20, newPerDay: 20 },
          },
        })}
        graph={taimanov}
        chapterId={CHAPTER}
        path={path}
      />
    </NextIntlClientProvider>,
  );
}

const iKnowThis = () => screen.getByRole('button', { name: know.iKnowThis });
const choice = (name: string) => screen.getByRole('group', { name });
/** Each open choice's name: the subject its group is labelled by. */
const choiceNames = () =>
  screen
    .queryAllByRole('group')
    .map(
      (group) =>
        document.getElementById(group.getAttribute('aria-labelledby') ?? '')
          ?.textContent,
    );

/** The fields each count asked for, in order. */
const countedFields = () =>
  server.count.mock.calls.map(([form]) => Object.fromEntries(form.entries()));

/** The fields a mocked action was last sent. */
function sent(action: typeof server.mark) {
  const form = action.mock.lastCall?.[0];
  if (form === undefined) throw new Error('the action was not called');
  return Object.fromEntries(form.entries());
}

beforeEach(() => {
  server.count.mockReset().mockResolvedValue(counts(3, 0));
  server.mark.mockReset().mockResolvedValue({ ok: true, changed: 1 });
  server.again.mockReset().mockResolvedValue({ ok: true, changed: 2 });
});

describe('TrainHere: Learn this line and this chapter (R-206)', () => {
  it('links to learning the current line and the chapter, each with its new moves', () => {
    renderHere(AT_QC7);
    // The main line's own moves: c5 e6 cxd4 Nc6 Qc7 a6 Nf6.
    const line = screen.getByRole('link', { name: 'Learn this line (7)' });
    expect(line.getAttribute('href')).toBe(
      `/training?mode=learn&r=${ID}&chapter=${CHAPTER}&line=0`,
    );
    // And those of the variations: a6 after 6. Be2, Nf6 after 7. O-O and
    // after 7. Be3 there, a6 after 6. g3.
    const chapter = screen.getByRole('link', {
      name: 'Learn this chapter (11)',
    });
    expect(chapter.getAttribute('href')).toBe(
      `/training?mode=learn&r=${ID}&chapter=${CHAPTER}`,
    );
  });

  it('has no Learn link where learning would teach nothing today', () => {
    renderHere(AT_QC7, { learnedToday: 20 });
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(iKnowThis()).toBeDefined();
  });

  it('has no line to learn at the chapter root, only the chapter', () => {
    renderHere([]);
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(
      ['Learn this chapter (11)'],
    );
  });
});

describe('TrainHere: one “I know this” (R-227)', () => {
  it('is closed and counts nothing until opened', () => {
    renderHere(AT_QC7);
    expect(iKnowThis().getAttribute('aria-expanded')).toBe('false');
    // Nothing to control while closed.
    expect(iKnowThis().hasAttribute('aria-controls')).toBe(false);
    expect(screen.queryAllByRole('group')).toEqual([]);
    expect(server.count).not.toHaveBeenCalled();
  });

  it('offers this move, this line and this chapter on an own move, each counted on opening', async () => {
    renderHere(AT_QC7);
    fireEvent.click(iKnowThis());
    expect(iKnowThis().getAttribute('aria-expanded')).toBe('true');
    expect(choiceNames()).toEqual([
      'This move, 5... Qc7',
      LINE_NAME,
      CHAPTER_NAME,
    ]);
    expect(iKnowThis().getAttribute('aria-controls')).toBe(
      screen.getByRole('group', { name: LINE_NAME }).parentElement?.id,
    );
    expect(
      await screen.findAllByRole('button', { name: 'Mark known (3 moves)' }),
    ).toHaveLength(3);
    expect(countedFields()).toEqual([
      {
        kind: 'move',
        repertoireId: ID,
        moveKey: moveKey(QC7?.from ?? '', 'Qc7'),
      },
      { kind: 'line', repertoireId: ID, chapterId: CHAPTER, lineIndex: '0' },
      { kind: 'chapter', repertoireId: ID, chapterId: CHAPTER },
    ]);
  });

  it('closes again', async () => {
    renderHere(AT_QC7);
    fireEvent.click(iKnowThis());
    await screen.findAllByRole('button', { name: 'Mark known (3 moves)' });
    fireEvent.click(iKnowThis());
    expect(iKnowThis().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('group')).toEqual([]);
  });

  it('has no move choice on an opponent move', () => {
    renderHere(AT_NC3);
    fireEvent.click(iKnowThis());
    expect(choiceNames()).toEqual([LINE_NAME, CHAPTER_NAME]);
  });

  it('has only the chapter at the chapter root', () => {
    renderHere([]);
    fireEvent.click(iKnowThis());
    expect(choiceNames()).toEqual([CHAPTER_NAME]);
  });

  it('counts the line and the chapter again once the move is marked known', async () => {
    let marked = false;
    server.count.mockImplementation((form) => {
      const left = marked ? 4 : 5;
      return Promise.resolve(
        form.get('kind') === 'move'
          ? counts(marked ? 0 : 1, 0)
          : counts(left, 0),
      );
    });
    server.mark.mockImplementation(() => {
      marked = true;
      return Promise.resolve({ ok: true, changed: 1 });
    });
    renderHere(AT_QC7);
    fireEvent.click(iKnowThis());
    const line = choice(LINE_NAME);
    await within(line).findByRole('button', { name: 'Mark known (5 moves)' });
    fireEvent.click(
      await within(choice('This move, 5... Qc7')).findByRole('button', {
        name: 'Mark known (1 move)',
      }),
    );
    expect(
      await within(line).findByRole('button', { name: 'Mark known (4 moves)' }),
    ).toBeDefined();
    expect(
      within(choice(CHAPTER_NAME)).getByRole('button', {
        name: 'Mark known (4 moves)',
      }),
    ).toBeDefined();
    // The move's own outcome stays said.
    expect(
      within(choice('This move, 5... Qc7')).getByText(
        '1 move marked as known.',
      ),
    ).toBeDefined();
  });

  it('marks the move at once, with no question', async () => {
    server.count.mockResolvedValue(counts(1, 0));
    renderHere(AT_QC7);
    fireEvent.click(iKnowThis());
    const move = choice('This move, 5... Qc7');
    fireEvent.click(
      await within(move).findByRole('button', {
        name: 'Mark known (1 move)',
      }),
    );
    await within(move).findByText('1 move marked as known.');
    expect(sent(server.mark)).toEqual({
      kind: 'move',
      repertoireId: ID,
      moveKey: moveKey(QC7?.from ?? '', 'Qc7'),
    });
  });

  it('asks before marking the line, with the count (R-147)', async () => {
    server.count.mockResolvedValue(counts(5, 0));
    renderHere(AT_QC7);
    fireEvent.click(iKnowThis());
    const line = choice(LINE_NAME);
    fireEvent.click(
      await within(line).findByRole('button', {
        name: 'Mark known (5 moves)',
      }),
    );
    expect(
      within(line).getByText(
        'Mark 5 moves as known? You skip learning them; the first review is tomorrow.',
      ),
    ).toBeDefined();
    expect(server.mark).not.toHaveBeenCalled();
    server.mark.mockResolvedValue({ ok: true, changed: 5 });
    fireEvent.click(within(line).getByRole('button', { name: know.confirm }));
    await within(line).findByText('5 moves marked as known.');
    expect(sent(server.mark)).toEqual({
      kind: 'line',
      repertoireId: ID,
      chapterId: CHAPTER,
      lineIndex: '0',
    });
  });

  it('asks before marking the chapter too', async () => {
    server.count.mockResolvedValue(counts(11, 0));
    renderHere([]);
    fireEvent.click(iKnowThis());
    const chapter = choice(CHAPTER_NAME);
    fireEvent.click(
      await within(chapter).findByRole('button', {
        name: 'Mark known (11 moves)',
      }),
    );
    expect(
      within(chapter).getByText(/^Mark 11 moves as known\?/),
    ).toBeDefined();
    expect(server.mark).not.toHaveBeenCalled();
  });

  it('says a known scope is known and offers to learn it again', async () => {
    server.count.mockResolvedValue(counts(0, 2));
    renderHere([]);
    fireEvent.click(iKnowThis());
    const chapter = choice(CHAPTER_NAME);
    fireEvent.click(
      await within(chapter).findByRole('button', {
        name: 'Learn again (2 moves)',
      }),
    );
    expect(within(chapter).getByText('Known (11 moves)')).toBeDefined();
    expect(
      within(chapter).queryByRole('button', { name: /Mark known/ }),
    ).toBeNull();
    await within(chapter).findByText('2 moves are back to learn.');
    expect(sent(server.again)).toEqual({
      kind: 'chapter',
      repertoireId: ID,
      chapterId: CHAPTER,
    });
  });

  it('counts the choices again for a new position', async () => {
    renderHere(AT_NC3);
    fireEvent.click(iKnowThis());
    await screen.findAllByRole('button', { name: 'Mark known (3 moves)' });
    expect(server.count).toHaveBeenCalledTimes(2);
    cleanup();
    server.count.mockClear();
    renderHere(AT_QC7);
    fireEvent.click(iKnowThis());
    await screen.findAllByRole('button', { name: 'Mark known (3 moves)' });
    expect(server.count).toHaveBeenCalledTimes(3);
  });
});

describe('knowChoices', () => {
  /** The choices at `path`, its line found as TrainHere finds it. */
  const choicesAt = (path: readonly RepertoireMove[]) =>
    knowChoices(
      {
        graph: taimanov,
        chapterId: CHAPTER,
        path,
        line: currentLineIndex(taimanov, CHAPTER, path),
      },
      ID,
    );
  const kinds = (path: readonly RepertoireMove[]) =>
    choicesAt(path).map((c) => c.fields.kind);

  it('offers the move only when it is the player’s own', () => {
    expect(kinds(AT_QC7)).toEqual(['move', 'line', 'chapter']);
    expect(kinds(AT_NC3)).toEqual(['line', 'chapter']);
    expect(kinds([])).toEqual(['chapter']);
  });

  it('names the move as the move list numbers it, and counts the line’s and chapter’s own moves', () => {
    const [move, line, chapter] = choicesAt(AT_QC7);
    expect(move !== undefined && 'label' in move ? move.label : null).toBe(
      '5... Qc7',
    );
    expect(line !== undefined && 'moves' in line ? line.moves : null).toBe(7);
    expect(
      chapter !== undefined && 'moves' in chapter ? chapter.moves : null,
    ).toBe(11);
  });

  it('keys each choice by its scope, so another scope counts afresh', () => {
    const at = (path: readonly RepertoireMove[]) =>
      choicesAt(path).map((c) => c.key);
    const [qc7Move, qc7Line, qc7Chapter] = at(AT_QC7);
    const [nc3Line, nc3Chapter] = at(AT_NC3);
    expect(qc7Line).toBe(nc3Line);
    expect(qc7Chapter).toBe(nc3Chapter);
    expect(new Set([qc7Move, qc7Line, qc7Chapter]).size).toBe(3);
    // The 6. Be2 line is another line.
    const [, be2] = lines(taimanov, CHAPTER);
    expect(at(be2?.slice(0, 12) ?? [])).not.toContain(qc7Line);
  });
});
