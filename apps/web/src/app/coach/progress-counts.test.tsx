import type { ProgressCounts as Counts } from '@mychess/chess';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { ProgressCounts } from './progress-counts';

const p = MESSAGES.coach.progress;

function show(counts: Counts, mastered = false): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ProgressCounts counts={counts} mastered={mastered} />
    </NextIntlClientProvider>,
  );
  return container;
}

describe('ProgressCounts (R-231)', () => {
  it('says the share learned, then the non-zero counts only, joined by a dot', () => {
    const container = show({ learned: 4, due: 4, skipped: 0, notStarted: 0 });
    expect(container.textContent).toBe('50% learned · 4 due');
    expect(container.textContent).not.toContain('marked as known');
    expect(container.textContent).not.toContain('to learn');
  });

  it('says every count when none is zero', () => {
    const container = show({ learned: 4, due: 1, skipped: 3, notStarted: 2 });
    expect(container.textContent).toBe(
      '40% learned · 1 due · 3 marked as known · 2 to learn',
    );
  });

  it('says the share learned even when none is learned yet', () => {
    const container = show({ learned: 0, due: 2, skipped: 0, notStarted: 2 });
    expect(container.textContent).toBe('0% learned · 2 due · 2 to learn');
  });

  it('writes the due part in the due tone', () => {
    show({ learned: 1, due: 43, skipped: 0, notStarted: 28 });
    expect(screen.getByText('43 due').className).toContain('text-due');
    expect(screen.getByText('1% learned').className).not.toContain('text-due');
  });

  it('says "Not started" when nothing is started', () => {
    const container = show({ learned: 0, due: 0, skipped: 0, notStarted: 12 });
    expect(container.textContent).toBe('Not started · 12 moves');
  });

  it('says "Not started" of one move in the singular', () => {
    const container = show({ learned: 0, due: 0, skipped: 0, notStarted: 1 });
    expect(container.textContent).toBe('Not started · 1 move');
  });

  it('shows the Mastered pill when mastered', () => {
    show({ learned: 4, due: 0, skipped: 0, notStarted: 0 }, true);
    expect(screen.getByText(p.mastered).className).toContain('rounded-pill');
    expect(screen.getByText('100% learned')).toBeTruthy();
  });

  it('shows no Mastered pill when not mastered', () => {
    show({ learned: 4, due: 0, skipped: 0, notStarted: 0 });
    expect(screen.queryByText(p.mastered)).toBeNull();
  });

  it('says nothing for an empty repertoire: the bar says "Nothing to learn"', () => {
    const container = show({ learned: 0, due: 0, skipped: 0, notStarted: 0 });
    expect(container.textContent).toBe('');
  });
});
