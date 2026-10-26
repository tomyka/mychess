import type { ProgressCounts } from '@mychess/chess';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { StateBar } from './state-bar';

const p = MESSAGES.lt.coach.progress;

function renderBar(counts: ProgressCounts, mastered = false): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
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
    expect(widthOf(container, '.bg-learned-subtle')).toBe('12.5%');
    expect(widthOf(container, '.bg-due')).toBe('12.5%');
  });

  it('says every count in words, never colour alone', () => {
    renderBar({ notStarted: 2, skipped: 3, due: 1, learned: 4 });
    expect(
      screen.getByText(
        '4 išmokta · 1 kartotinas · 3 pažymėta „Žinau“ · 2 liko išmokti',
      ),
    ).toBeTruthy();
  });

  it('declines the due count in Lithuanian', () => {
    renderBar({ notStarted: 0, skipped: 0, due: 3, learned: 0 });
    expect(screen.getByText(/3 kartotini /)).toBeTruthy();
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
