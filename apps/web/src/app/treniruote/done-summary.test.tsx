import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { DoneActions, DoneSummary } from './done-summary';

const T = MESSAGES.lt.training.done;

const renderLt = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      {node}
    </NextIntlClientProvider>,
  );

const REVIEW = {
  kind: 'review',
  reviewed: 30,
  correct: 27,
  lapses: 3,
} as const;

/** 10:00 in Vilnius on 26 October 2026, winter time. */
const NEXT = new Date('2026-10-26T08:00:00Z');
const PROGRESS = { learned: 142, due: 6, toLearn: 18, nextReview: NEXT };

/** The number the summary shows under `label`. */
const stat = (label: string): string | null =>
  screen.getByText(label).parentElement?.querySelector('dd')?.textContent ??
  null;

/** The bottom bar's buttons and links, in the order they show. */
const actionNames = (): (string | null)[] =>
  Array.from(document.querySelectorAll('a, button'), (e) => e.textContent);

afterEach(() => {
  vi.useRealTimers();
});

describe('the done summary', () => {
  it('shows the review counts and takes focus on its heading', () => {
    renderLt(<DoneSummary progress={PROGRESS} counts={REVIEW} />);
    const heading = screen.getByRole('heading', { name: T.title });
    expect(document.activeElement).toBe(heading);
    expect(stat(T.reviewed)).toBe('30');
    expect(stat(T.correct)).toBe('27');
    expect(stat(T.lapses)).toBe('3');
  });

  it('shows how many moves a learn pass taught', () => {
    renderLt(
      <DoneSummary
        progress={PROGRESS}
        counts={{ kind: 'learn', learned: 8 }}
      />,
    );
    expect(stat(T.learned)).toBe('8');
    expect(screen.queryByText(T.lapses)).toBeNull();
  });

  it('says when the next review is, in Vilnius time, and where the repertoire stands', () => {
    vi.useFakeTimers({
      now: new Date('2026-10-25T07:00:00Z'),
      toFake: ['Date'],
    });
    renderLt(<DoneSummary progress={PROGRESS} counts={REVIEW} />);
    expect(screen.getByText('Kitas kartojimas: rytoj 10:00')).toBeDefined();
    expect(
      screen.getByText('142 išmokta · 6 kartotini · 18 liko išmokti'),
    ).toBeDefined();
  });

  it('leaves the next review out when none is scheduled', () => {
    renderLt(
      <DoneSummary
        progress={{ learned: 0, due: 0, toLearn: 4, nextReview: null }}
        counts={REVIEW}
      />,
    );
    expect(screen.queryByText(/^Kitas kartojimas:/)).toBeNull();
    expect(
      screen.getByText('0 išmokta · 0 kartotinų · 4 liko išmokti'),
    ).toBeDefined();
  });

  it('draws the progress bar on a border-toned track, visible on the dark page', () => {
    const { container } = renderLt(
      <DoneSummary progress={PROGRESS} counts={REVIEW} />,
    );
    const track = container.querySelector('.bg-learned')?.parentElement;
    expect(track?.classList).toContain('bg-border');
    expect(track?.classList).not.toContain('bg-sunken');
  });
});

describe('the done summary’s buttons', () => {
  it('offers Continue only when more items exist', () => {
    const { unmount } = renderLt(<DoneActions doneHref="/" />);
    expect(screen.queryByRole('button', { name: T.continue })).toBeNull();
    unmount();
    const more = vi.fn();
    renderLt(<DoneActions onContinue={more} doneHref="/" />);
    fireEvent.click(screen.getByRole('button', { name: T.continue }));
    expect(more).toHaveBeenCalledOnce();
  });

  it('offers new moves only while the allowance is left, and leads back', () => {
    const { unmount } = renderLt(<DoneActions doneHref="/repertuarai/r1" />);
    expect(screen.queryByRole('link', { name: T.learn })).toBeNull();
    expect(
      screen.getByRole('link', { name: T.done }).getAttribute('href'),
    ).toBe('/repertuarai/r1');
    unmount();
    renderLt(<DoneActions learnHref="/treniruote?mode=learn" doneHref="/" />);
    expect(
      screen.getByRole('link', { name: T.learn }).getAttribute('href'),
    ).toBe('/treniruote?mode=learn');
  });

  it('puts Done first and new moves last, Continue between them', () => {
    renderLt(
      <DoneActions
        onContinue={vi.fn()}
        learnHref="/treniruote?mode=learn"
        doneHref="/"
      />,
    );
    expect(actionNames()).toEqual([T.done, T.continue, T.learn]);
  });
});
