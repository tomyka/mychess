import type { ProgressCounts } from '@mychess/chess';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { MasteredBadge } from '../mastered-badge';
import { StateBar, usePercentLearned } from './state-bar';

const p = MESSAGES.coach.progress;

function renderBar(counts: ProgressCounts, mastered = false): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <StateBar counts={counts} mastered={mastered} />
    </NextIntlClientProvider>,
  );
  return container;
}

const widthOf = (container: HTMLElement, selector: string): string =>
  container.querySelector<HTMLElement>(selector)?.style.width ?? 'missing';

describe('StateBar (R-151)', () => {
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

  it('says every count in words, never colour alone', () => {
    renderBar({ notStarted: 2, skipped: 3, due: 1, learned: 4 });
    expect(
      screen.getByText('4 learned · 1 due · 3 marked as known · 2 to learn'),
    ).toBeTruthy();
  });

  it('hides the bar from screen readers, which read the words', () => {
    const container = renderBar({
      notStarted: 1,
      skipped: 0,
      due: 0,
      learned: 1,
    });
    expect(
      container
        .querySelector('.bg-learned')
        ?.parentElement?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('shows the Mastered badge only when mastered', () => {
    const counts = { notStarted: 0, skipped: 0, due: 0, learned: 4 };
    renderBar(counts, true);
    expect(screen.getByText(p.mastered)).toBeTruthy();
  });

  it('shows no Mastered badge when not mastered', () => {
    renderBar({ notStarted: 0, skipped: 0, due: 0, learned: 4 }, false);
    expect(screen.queryByText(p.mastered)).toBeNull();
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

  it('is the same pill the state bar draws', () => {
    const own = renderIn(<MasteredBadge />).innerHTML;
    const bar = renderBar(
      { notStarted: 0, skipped: 0, due: 0, learned: 1 },
      true,
    );
    expect(bar.innerHTML).toContain(own);
  });
});

/** Shows what usePercentLearned says, and whether it is empty. */
function Probe({ counts }: { readonly counts: ProgressCounts }): ReactNode {
  const { text, empty } = usePercentLearned(counts);
  return <span data-empty={String(empty)}>{text}</span>;
}

describe('usePercentLearned', () => {
  it('says the share learned', () => {
    renderIn(
      <Probe counts={{ notStarted: 1, skipped: 0, due: 1, learned: 2 }} />,
    );
    expect(screen.getByText('50% learned').getAttribute('data-empty')).toBe(
      'false',
    );
  });

  it('says there is nothing to learn for an empty repertoire', () => {
    renderIn(
      <Probe counts={{ notStarted: 0, skipped: 0, due: 0, learned: 0 }} />,
    );
    expect(screen.getByText(p.nothing).getAttribute('data-empty')).toBe('true');
  });
});
