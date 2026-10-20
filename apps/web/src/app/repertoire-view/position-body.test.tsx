import { moveKey, type RepertoireMove } from '@mychess/chess';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
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
