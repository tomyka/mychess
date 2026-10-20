import { moveKey, type RepertoireMove } from '@mychess/chess';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import type { CommentEditor } from './comment';
import type { FieldOutcome } from './field-save';
import { PersonalNote } from './personal-note';
import { PositionBody, type PositionBodyProps } from './position-body';

const BF4: RepertoireMove = {
  from: 'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq -',
  to: 'rnbqkbnr/ppp1pppp/8/3p4/3P1B2/8/PPP1PPPP/RN1QKBNR b KQkq -',
  san: 'Bf4',
  uci: 'c1f4',
  arrows: [{ from: 'g1', to: 'f3', color: 'G' }],
  circles: [],
  comment: 'The London bishop',
  chapters: ['c1'],
};

const en = MESSAGES.en.repertoires;
const p = en.panel;

function renderBody(over: Partial<PositionBodyProps> = {}): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
      <PositionBody intro="Solid and quick." move={null} {...over} />
    </NextIntlClientProvider>,
  );
}

const commentSection = (name: string = p.comment) =>
  within(screen.getByRole('region', { name }));

describe('PositionBody', () => {
  it('shows the chapter intro at the root, and no notes there', () => {
    const renderNotes = vi.fn(() => <p>A note</p>);
    renderBody({ renderNotes });
    const intro = within(screen.getByRole('region', { name: p.intro }));
    expect(intro.getByText(p.intro)).toBeDefined();
    expect(intro.getByText('Solid and quick.')).toBeDefined();
    expect(renderNotes).not.toHaveBeenCalled();
    expect(screen.queryByText('A note')).toBeNull();
  });

  it('shows nothing at a root without an intro', () => {
    renderBody({ intro: null });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows the move’s comment and its marks as words, not the intro', () => {
    renderBody({ move: BF4 });
    const section = commentSection();
    expect(section.getByText(p.comment)).toBeDefined();
    expect(section.getByText('The London bishop')).toBeDefined();
    expect(section.getByText('Arrows: g1 to f3, green')).toBeDefined();
    expect(screen.queryByText('Solid and quick.')).toBeNull();
  });

  it('shows what renderNotes gives for the move’s key, in the move’s section', () => {
    const renderNotes = vi.fn((key: string) => <p>{`Note on ${key}`}</p>);
    renderBody({ move: BF4, renderNotes });
    const key = moveKey(BF4.from, BF4.san);
    expect(renderNotes).toHaveBeenCalledWith(key);
    expect(commentSection().getByText(`Note on ${key}`)).toBeDefined();
  });

  it('shows the comment alone without renderNotes', () => {
    renderBody({ move: BF4 });
    expect(commentSection().queryByText(/Note on/)).toBeNull();
    expect(screen.getAllByRole('region')).toHaveLength(1);
  });

  it('names the comment with the view’s label (a coach’s comment is a Coach note)', () => {
    renderBody({ move: BF4, commentLabel: 'Coach note from Dovydas' });
    const section = commentSection('Coach note from Dovydas');
    expect(section.getByText('Coach note from Dovydas')).toBeDefined();
    expect(section.getByText('The London bishop')).toBeDefined();
    expect(screen.queryByText(p.comment)).toBeNull();
  });

  it('shows the builder’s comment field when given an editor', () => {
    renderBody({
      intro: null,
      move: BF4,
      commentEditor: { disabled: false, onSave: vi.fn() },
    });
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', {
        name: en.builder.commentLabel,
      }).value,
    ).toBe('The London bishop');
  });
});

/** BF4 with a circle too, so both kinds of mark are spoken. */
const MARKED: RepertoireMove = {
  ...BF4,
  circles: [{ square: 'd4', color: 'R' }],
};

/** The position body as the owner's page fills it: a Personal note per move. */
function renderOwner(
  over: {
    readonly intro?: string | null;
    readonly move?: RepertoireMove | null;
    readonly commentEditor?: CommentEditor;
  } = {},
): void {
  const { intro = 'The London: solid and quick.', move = null } = over;
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
      <PositionBody
        intro={intro}
        move={move}
        commentEditor={over.commentEditor}
        renderNotes={(key) => (
          <PersonalNote
            key={key}
            initial=""
            onSaveNote={vi.fn().mockResolvedValue({ ok: true })}
          />
        )}
      />
    </NextIntlClientProvider>,
  );
}

describe('PositionBody with the owner’s notes', () => {
  it('shows the chapter intro at the root, and no note there', () => {
    renderOwner();
    expect(screen.getByText('The London: solid and quick.')).toBeDefined();
    expect(screen.queryByLabelText(en.note.label)).toBeNull();
  });

  it('shows nothing at a root without an intro', () => {
    renderOwner({ intro: null });
    expect(screen.queryByText(p.intro)).toBeNull();
  });

  it('shows the move’s comment and its marks as text', () => {
    renderOwner({ move: MARKED });
    expect(screen.getByText('The London bishop')).toBeDefined();
    expect(screen.getByText('Arrows: g1 to f3, green')).toBeDefined();
    expect(screen.getByText('Circles: d4, red')).toBeDefined();
    expect(screen.queryByText('The London: solid and quick.')).toBeNull();
  });

  it('says when a move has no comment', () => {
    renderOwner({
      move: { ...MARKED, comment: null, arrows: [], circles: [] },
    });
    expect(screen.getByText(p.noComment)).toBeDefined();
    expect(screen.queryByText(/Arrows/)).toBeNull();
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

  it('edits the comment in a field with the one-paragraph hint, and says it saved', async () => {
    const editor = builder();
    renderOwner({ move: MARKED, commentEditor: editor });
    expect(commentField().value).toBe('The London bishop');
    expect(screen.getByText(en.builder.commentHint)).toBeDefined();
    fireEvent.change(commentField(), { target: { value: 'Develop first' } });
    fireEvent.click(
      screen.getByRole('button', { name: en.builder.commentSave }),
    );
    expect(await screen.findByText(en.builder.commentSaved)).toBeDefined();
    expect(editor.onSave).toHaveBeenCalledWith('Develop first');
  });

  it('shows a refusal under the field and marks it invalid', async () => {
    renderOwner({
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
    expect(await screen.findByText(MESSAGES.en.comment.tooLong)).toBeDefined();
    expect(commentField().getAttribute('aria-invalid')).toBe('true');
  });

  it('counts the characters from 1,800 on', () => {
    renderOwner({ move: MARKED, commentEditor: builder() });
    fireEvent.change(commentField(), { target: { value: 'a'.repeat(1799) } });
    expect(screen.queryByText(/\/ 2,000/)).toBeNull();
    fireEvent.change(commentField(), { target: { value: 'a'.repeat(1850) } });
    expect(screen.getByText('1,850 / 2,000')).toBeDefined();
  });

  it('cannot save while the screen is saving', () => {
    renderOwner({ move: MARKED, commentEditor: builder({ disabled: true }) });
    expect(
      screen.getByRole('button', { name: en.builder.commentSave }),
    ).toHaveProperty('disabled', true);
  });

  it('keeps the chapter intro read-only (R-112)', () => {
    renderOwner({ commentEditor: builder() });
    expect(screen.getByText('The London: solid and quick.')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
