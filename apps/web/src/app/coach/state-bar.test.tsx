import type { ProgressCounts } from '@mychess/chess';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { MasteredBadge } from '../mastered-badge';
import { StateBar } from './state-bar';

const p = MESSAGES.coach.progress;

function renderBar(
  counts: ProgressCounts,
  size: 'row' | 'header' = 'row',
): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <StateBar counts={counts} size={size} />
    </NextIntlClientProvider>,
  );
  return container;
}

const widthOf = (container: HTMLElement, selector: string): string =>
  container.querySelector<HTMLElement>(selector)?.style.width ?? 'missing';

const SOME = { notStarted: 1, skipped: 0, due: 0, learned: 1 };

describe('StateBar (R-151, R-231)', () => {
  it('gives each state a segment in proportion', () => {
    const container = renderBar({
      notStarted: 2,
      skipped: 1,
      due: 1,
      learned: 4,
    });
    expect(widthOf(container, '.bg-learned')).toBe('50%');
    expect(widthOf(container, '.bg-skipped')).toBe('12.5%');
    expect(widthOf(container, '.bg-due')).toBe('12.5%');
  });

  it('draws only the bar: the counts in words are ProgressCounts', () => {
    const container = renderBar({
      notStarted: 2,
      skipped: 3,
      due: 1,
      learned: 4,
    });
    expect(container.textContent).toBe('');
  });

  it('hides the bar from screen readers, which read the words', () => {
    const container = renderBar(SOME);
    expect(
      container
        .querySelector('.bg-learned')
        ?.parentElement?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('is 6px high in a row', () => {
    const bar = renderBar(SOME, 'row').querySelector('[aria-hidden="true"]');
    expect(bar?.className).toContain('h-1.5');
    expect(bar?.className).not.toContain('h-2');
  });

  it('is 8px high in a page header', () => {
    const bar = renderBar(SOME, 'header').querySelector('[aria-hidden="true"]');
    expect(bar?.className).toContain('h-2');
    expect(bar?.className).not.toContain('h-1.5');
  });

  it('says there is nothing to learn when there are no own moves', () => {
    const container = renderBar({
      notStarted: 0,
      skipped: 0,
      due: 0,
      learned: 0,
    });
    expect(screen.getByText(p.nothing)).toBeTruthy();
    expect(container.querySelector('.bg-learned')).toBeNull();
  });
});

function renderIn(node: ReactNode): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {node}
    </NextIntlClientProvider>,
  );
  return container;
}

describe('MasteredBadge', () => {
  it('is the Mastered pill', () => {
    renderIn(<MasteredBadge />);
    const badge = screen.getByText(p.mastered);
    expect(badge.className).toContain('rounded-pill');
    expect(badge.className).toContain('bg-success-subtle');
  });
});
