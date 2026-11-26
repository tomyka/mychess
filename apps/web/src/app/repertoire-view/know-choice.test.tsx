import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { SECONDARY_BUTTON, TONAL_BUTTON } from '../buttons';
import type { KnowCounts, KnowOutcome } from '../repertoires/know-actions';
import { KnowChoice, type KnowFields } from './know-choice';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const know = MESSAGES.training.know;

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

const MOVE: KnowFields = { kind: 'move', repertoireId: ID, moveKey: 'k|d4' };
const LINE: KnowFields = {
  kind: 'line',
  repertoireId: ID,
  chapterId: 'c1',
  lineIndex: '1',
};

/** The choice of `fields`; a line covers 7 moves, a move is one. */
function choiceOf(
  fields: KnowFields,
  version = 0,
  onActed: () => void = vi.fn(),
) {
  return (
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <KnowChoice
        fields={fields}
        subject="This move, 1. d4"
        moves={fields.kind === 'move' ? null : 7}
        version={version}
        onActed={onActed}
      />
    </NextIntlClientProvider>
  );
}

const renderChoice = (fields: KnowFields, onActed?: () => void) =>
  render(choiceOf(fields, 0, onActed));

/** The fields a mocked action was last sent. */
function sent(action: typeof server.count | typeof server.mark) {
  const form = action.mock.lastCall?.[0];
  if (form === undefined) throw new Error('the action was not called');
  return Object.fromEntries(form.entries());
}

const counts = (know: number, again: number): KnowCounts => ({
  ok: true,
  know,
  again,
});

const markKnown = (count: number) =>
  count === 1 ? 'Mark known (1 move)' : `Mark known (${String(count)} moves)`;

beforeEach(() => {
  server.count.mockReset().mockResolvedValue(counts(1, 0));
  server.mark.mockReset().mockResolvedValue({ ok: true, changed: 1 });
  server.again.mockReset().mockResolvedValue({ ok: true, changed: 2 });
});

describe('KnowChoice (R-58, R-147, R-227)', () => {
  it('is a group named by its subject, counted as it mounts', async () => {
    renderChoice(MOVE);
    expect(
      screen.getByRole('group', { name: 'This move, 1. d4' }),
    ).toBeDefined();
    expect(screen.getByText(know.loading)).toBeDefined();
    await screen.findByRole('button', { name: markKnown(1) });
    expect(sent(server.count)).toEqual(MOVE);
  });

  it('marks a single move at once, with no confirm, and says it acted', async () => {
    const onActed = vi.fn();
    renderChoice(MOVE, onActed);
    fireEvent.click(await screen.findByRole('button', { name: markKnown(1) }));
    await screen.findByText('1 move marked as known.');
    expect(sent(server.mark)).toEqual(MOVE);
    expect(onActed).toHaveBeenCalledOnce();
  });

  it('counts again when the version moves on, and only then', async () => {
    const view = render(choiceOf(LINE, 0));
    await screen.findByRole('button', { name: markKnown(1) });
    view.rerender(choiceOf(LINE, 0));
    expect(server.count).toHaveBeenCalledOnce();
    server.count.mockResolvedValue(counts(0, 0));
    view.rerender(choiceOf(LINE, 1));
    await screen.findByText('All 7 moves are already in review.');
    expect(server.count).toHaveBeenCalledTimes(2);
  });

  it('drops a count that comes back after the version moved on', async () => {
    let answerFirst: (counts: KnowCounts) => void = () => undefined;
    server.count.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
    );
    server.count.mockResolvedValueOnce(counts(4, 0));
    const view = render(choiceOf(LINE, 0));
    view.rerender(choiceOf(LINE, 1));
    await screen.findByRole('button', { name: markKnown(4) });
    await act(async () => {
      answerFirst(counts(9, 0));
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: markKnown(9) })).toBeNull();
    expect(screen.getByRole('button', { name: markKnown(4) })).toBeDefined();
  });

  it('asks before marking a line, with the count', async () => {
    server.count.mockResolvedValue(counts(5, 0));
    renderChoice(LINE);
    fireEvent.click(await screen.findByRole('button', { name: markKnown(5) }));
    expect(
      screen.getByText(
        'Mark 5 moves as known? You skip learning them; the first review is tomorrow.',
      ),
    ).toBeDefined();
    expect(server.mark).not.toHaveBeenCalled();
    server.mark.mockResolvedValue({ ok: true, changed: 5 });
    fireEvent.click(screen.getByRole('button', { name: know.confirm }));
    await screen.findByText('5 moves marked as known.');
    expect(sent(server.mark)).toEqual(LINE);
  });

  it('weighs Mark known as the content’s action and Learn again as a secondary one', async () => {
    server.count.mockResolvedValue(counts(1, 2));
    renderChoice(LINE);
    const mark = await screen.findByRole('button', { name: markKnown(1) });
    expect(mark.className).toContain(TONAL_BUTTON);
    expect(
      screen.getByRole('button', { name: 'Learn again (2 moves)' }).className,
    ).toContain(SECONDARY_BUTTON);
  });

  it('offers Learn again only when there are skipped moves', async () => {
    renderChoice(LINE);
    await screen.findByRole('button', { name: markKnown(1) });
    expect(screen.queryByRole('button', { name: /Learn again/ })).toBeNull();
    expect(screen.queryByText(/^Known/)).toBeNull();
  });

  it('says a known line is known, with its move count, and returns the skipped moves', async () => {
    server.count.mockResolvedValue(counts(0, 2));
    renderChoice(LINE);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Learn again (2 moves)' }),
    );
    expect(screen.getByText('Known (7 moves)')).toBeDefined();
    await screen.findByText('2 moves are back to learn.');
    expect(sent(server.again)).toEqual(LINE);
    expect(server.mark).not.toHaveBeenCalled();
  });

  it('says a known move is known, with no count', async () => {
    server.count.mockResolvedValue(counts(0, 1));
    renderChoice(MOVE);
    expect(await screen.findByText(know.knownMove)).toBeDefined();
  });

  it('says so, with the count, when every move of a line is in review', async () => {
    server.count.mockResolvedValue(counts(0, 0));
    renderChoice(LINE);
    expect(
      await screen.findByText('All 7 moves are already in review.'),
    ).toBeDefined();
  });

  it('says a move in review in the singular', async () => {
    server.count.mockResolvedValue(counts(0, 0));
    renderChoice(MOVE);
    expect(await screen.findByText(know.nothingMove)).toBeDefined();
  });

  it('shows a refusal in words', async () => {
    server.count.mockResolvedValue({
      ok: false,
      refusal: 'training.notTrained',
    });
    renderChoice(MOVE);
    expect(await screen.findByText(MESSAGES.training.notTrained)).toBeDefined();
  });

  it('shows a refused action as an error', async () => {
    renderChoice(MOVE);
    server.mark.mockResolvedValue({
      ok: false,
      refusal: 'training.notTrained',
    });
    fireEvent.click(await screen.findByRole('button', { name: markKnown(1) }));
    const status = await screen.findByText(MESSAGES.training.notTrained);
    expect(status.getAttribute('role')).toBe('status');
    expect(status.className).toContain('text-error');
  });

  it('says a failed request failed', async () => {
    server.count.mockRejectedValue(new Error('offline'));
    renderChoice(MOVE);
    expect(await screen.findByText(know.failed)).toBeDefined();
  });
});
