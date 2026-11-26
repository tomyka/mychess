import type { Standing } from '@mychess/chess';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import { StandingLine } from './standing-line';

/** A standing of these counts, mastered only when said. */
const standing = (
  learned: number,
  due: number,
  notStarted: number,
  mastered = false,
): Standing => ({
  counts: { learned, due, notStarted, skipped: 0 },
  mastered,
});

function renderLine(of: Standing, due: number): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <StandingLine standing={of} due={due} />
    </NextIntlClientProvider>,
  );
  return container;
}

describe('StandingLine (R-225, R-177)', () => {
  it('says the learned share and the due count', () => {
    renderLine(standing(6, 3, 1), 3);
    expect(screen.getByText('60% learned · 3 due')).toBeDefined();
  });

  it('says the learned share alone with nothing due', () => {
    renderLine(standing(6, 0, 4), 0);
    expect(screen.getByText('60% learned')).toBeDefined();
  });

  it('says New with the size when nothing is learned or due', () => {
    renderLine(standing(0, 0, 18), 0);
    expect(screen.getByText('New · 18 moves')).toBeDefined();
  });

  it('counts one move as one', () => {
    renderLine(standing(0, 0, 1), 0);
    expect(screen.getByText('New · 1 move')).toBeDefined();
  });

  it('says the due count, not New, when nothing is learned yet but moves are due', () => {
    renderLine(standing(0, 2, 8), 2);
    expect(screen.getByText('0% learned · 2 due')).toBeDefined();
  });

  it('says the share, not New, when every move entered by "I know this" (R-151)', () => {
    renderLine(
      {
        counts: { learned: 0, due: 0, notStarted: 0, skipped: 4 },
        mastered: false,
      },
      0,
    );
    expect(screen.getByText('0% learned')).toBeDefined();
    expect(screen.queryByText(/New/u)).toBeNull();
  });

  it('says the share, not New, once any move is started', () => {
    renderLine(
      {
        counts: { learned: 0, due: 0, notStarted: 9, skipped: 1 },
        mastered: false,
      },
      0,
    );
    expect(screen.getByText('0% learned')).toBeDefined();
  });

  it('says Mastered instead of the share (R-178)', () => {
    renderLine(standing(5, 0, 0, true), 0);
    expect(screen.getByText('Mastered')).toBeDefined();
    expect(screen.queryByText(/learned/u)).toBeNull();
  });

  it('shows Mastered as Today’s success pill, not as muted text', () => {
    renderLine(standing(5, 0, 0, true), 0);
    expect([...screen.getByText('Mastered').classList]).toEqual(
      expect.arrayContaining([
        'rounded-pill',
        'bg-success-subtle',
        'text-success',
      ]),
    );
  });

  it('shows nothing without own moves', () => {
    expect(renderLine(standing(0, 0, 0), 0).innerHTML).toBe('');
  });
});
