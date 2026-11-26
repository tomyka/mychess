import { moveKey, type RepertoireMove } from '@mychess/chess';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { CommentEditor } from './comment';
import type { FieldOutcome } from './field-save';
import {
  PositionBody,
  PositionEdit,
  type PositionBodyProps,
  type PositionEditProps,
} from './position-body';

const BF4: RepertoireMove = {
  from: 'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq -',
  to: 'rnbqkbnr/ppp1pppp/8/3p4/3P1B2/8/PPP1PPPP/RN1QKBNR b KQkq -',
  san: 'Bf4',
  uci: 'c1f4',
  arrows: [{ from: 'g1', to: 'f3', color: 'G' }],
  circles: [],
  comment: 'The London bishop',
  nags: [],
  chapters: ['c1'],
};

/** BF4 with a circle too, so both kinds of mark are spoken. */
const MARKED: RepertoireMove = {
  ...BF4,
  circles: [{ square: 'd4', color: 'R' }],
};

const en = MESSAGES.repertoires;
const p = en.panel;

/** Both parts as the panel places them: the edit part, then the body. */
function renderBody(
  over: Partial<PositionEditProps & PositionBodyProps> = {},
): void {
  const props: PositionEditProps & PositionBodyProps = {
    intro: 'Solid and quick.',
    move: null,
    mode: 'browse',
    ...over,
  };
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <PositionEdit {...props} />
      <PositionBody move={props.move} renderNotes={props.renderNotes} />
    </NextIntlClientProvider>,
  );
}

describe('PositionBody while browsing (the strip shows the comment and intro)', () => {
  it('shows nothing at the chapter root, and no notes there', () => {
    const renderNotes = vi.fn(() => <p>A note</p>);
    renderBody({ renderNotes });
    expect(screen.queryByText('Solid and quick.')).toBeNull();
    expect(screen.queryByText('A note')).toBeNull();
    expect(renderNotes).not.toHaveBeenCalled();
  });

  it('keeps the move’s marks as words, but not its comment', () => {
    renderBody({ move: MARKED });
    expect(screen.getByText('Arrows: g1 to f3, green')).toBeDefined();
    expect(screen.getByText('Circles: d4, red')).toBeDefined();
    expect(screen.queryByText('The London bishop')).toBeNull();
    expect(screen.queryByText(p.comment)).toBeNull();
  });

  it('shows what renderNotes gives for the move’s key', () => {
    const renderNotes = vi.fn((key: string) => <p>{`Note on ${key}`}</p>);
    renderBody({ move: BF4, renderNotes });
    const key = moveKey(BF4.from, BF4.san);
    expect(renderNotes).toHaveBeenCalledWith(key);
    expect(screen.getByText(`Note on ${key}`)).toBeDefined();
  });

  it('says no marks on a move without them', () => {
    renderBody({ move: { ...BF4, arrows: [] } });
    expect(screen.queryByText(/Arrows/)).toBeNull();
    expect(screen.queryByText(/Circles/)).toBeNull();
  });
});

describe('PositionBody in builder mode', () => {
  const builder = (over: Partial<CommentEditor> = {}) => ({
    disabled: false,
    onSave: vi
      .fn<(text: string) => Promise<FieldOutcome>>()
      .mockResolvedValue({ ok: true }),
    ...over,
  });
  const commentField = () =>
    screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: en.builder.commentLabel,
    });

  it('keeps the chapter intro read-only at the root (R-112)', () => {
    renderBody({ mode: 'build', commentEditor: builder() });
    expect(screen.getByRole('region', { name: p.intro }).textContent).toContain(
      'Solid and quick.',
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows nothing at a root without an intro', () => {
    renderBody({ mode: 'build', intro: null });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('edits the comment in a field with the one-paragraph hint, and says it saved', async () => {
    const editor = builder();
    renderBody({ mode: 'build', move: MARKED, commentEditor: editor });
    expect(commentField().value).toBe('The London bishop');
    expect(screen.getByText(en.builder.commentHint)).toBeDefined();
    expect(screen.getByText('Arrows: g1 to f3, green')).toBeDefined();
    fireEvent.change(commentField(), { target: { value: 'Develop first' } });
    fireEvent.click(
      screen.getByRole('button', { name: en.builder.commentSave }),
    );
    expect(await screen.findByText(en.builder.commentSaved)).toBeDefined();
    expect(editor.onSave).toHaveBeenCalledWith('Develop first');
  });

  it('shows a refusal under the field and marks it invalid', async () => {
    renderBody({
      mode: 'build',
      move: MARKED,
      commentEditor: builder({
        onSave: vi.fn().mockResolvedValue({
          ok: false,
          refusal: 'comment.tooLong',
        }),
      }),
    });
    fireEvent.click(
      screen.getByRole('button', { name: en.builder.commentSave }),
    );
    expect(await screen.findByText(MESSAGES.comment.tooLong)).toBeDefined();
    expect(commentField().getAttribute('aria-invalid')).toBe('true');
  });

  it('counts the characters from 1,800 on', () => {
    renderBody({ mode: 'build', move: MARKED, commentEditor: builder() });
    fireEvent.change(commentField(), { target: { value: 'a'.repeat(1799) } });
    expect(screen.queryByText(/\/ 2,000/)).toBeNull();
    fireEvent.change(commentField(), { target: { value: 'a'.repeat(1850) } });
    expect(screen.getByText('1,850 / 2,000')).toBeDefined();
  });

  it('cannot save while the screen is saving', () => {
    renderBody({
      mode: 'build',
      move: MARKED,
      commentEditor: builder({ disabled: true }),
    });
    expect(
      screen.getByRole('button', { name: en.builder.commentSave }),
    ).toHaveProperty('disabled', true);
  });

  it('shows the move’s notes under the field', () => {
    renderBody({
      mode: 'build',
      move: BF4,
      commentEditor: builder(),
      renderNotes: (key) => <p>{`Note on ${key}`}</p>,
    });
    expect(
      screen.getByText(`Note on ${moveKey(BF4.from, BF4.san)}`),
    ).toBeDefined();
  });
});
