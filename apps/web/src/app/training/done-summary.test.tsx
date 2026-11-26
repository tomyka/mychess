import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { NOTHING_MORE, type DoneOffer } from './done-offer';
import { DoneActions, DoneSummary } from './done-summary';

const T = MESSAGES.training.done;

const renderIn = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {node}
    </NextIntlClientProvider>,
  );

const REVIEW = {
  kind: 'review',
  reviewed: 30,
  passed: 27,
  lapses: 3,
} as const;

/** 10:00 in Vilnius on 26 October 2026, winter time. */
const NEXT = new Date('2026-10-26T08:00:00Z');
const PROGRESS = { reviewed: 142, due: 6, toLearn: 18, nextDue: NEXT };
/** Six moves still due when the session ends. */
const DUE = {
  progress: PROGRESS,
  standing: { kind: 'due', count: 6 },
} as const;

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
    renderIn(<DoneSummary {...DUE} counts={REVIEW} />);
    const heading = screen.getByRole('heading', { name: T.title });
    expect(document.activeElement).toBe(heading);
    expect(stat(T.reviewed)).toBe('30');
    expect(stat(T.firstTry)).toBe('27');
    expect(stat(T.lapses)).toBe('3');
  });

  it('shows how many moves a learn pass taught', () => {
    renderIn(<DoneSummary {...DUE} counts={{ kind: 'learn', learned: 8 }} />);
    expect(stat(T.learned)).toBe('8');
    expect(screen.queryByText(T.lapses)).toBeNull();
  });

  it('does not call a learn pass the end of today’s review, only says when the next one is', () => {
    vi.useFakeTimers({
      now: new Date('2026-10-25T07:00:00Z'),
      toFake: ['Date'],
    });
    renderIn(
      <DoneSummary
        progress={{ ...PROGRESS, due: 0 }}
        standing={{ kind: 'dayDone', next: NEXT }}
        counts={{ kind: 'learn', learned: 3 }}
      />,
    );
    expect(screen.queryByText(T.dayDone)).toBeNull();
    expect(screen.getByText('Next review: tomorrow at 10:00')).toBeDefined();
  });

  it('shows the session as a card with a success tick above its heading', () => {
    renderIn(<DoneSummary {...DUE} counts={REVIEW} />);
    const card = screen.getByRole('region', { name: T.title });
    expect(card.className).toContain('rounded-card');
    const tick = card.firstElementChild;
    expect(tick?.getAttribute('aria-hidden')).toBe('true');
    expect(tick?.className).toContain('text-success');
    expect(tick?.querySelector('svg')).not.toBeNull();
  });

  it('says how many moves are still due, not a later review, while some are (#319, R-62)', () => {
    renderIn(<DoneSummary {...DUE} counts={REVIEW} />);
    expect(screen.getByText('6 more moves are due.')).toBeDefined();
    expect(screen.queryByText(/^Next review:/)).toBeNull();
    expect(screen.queryByText(T.dayDone)).toBeNull();
    expect(screen.getByText('142 learned · 6 due · 18 to learn')).toBeDefined();
  });

  it('says when a move comes back later today, without calling the day done (R-78)', () => {
    vi.useFakeTimers({
      now: new Date('2026-10-25T07:50:00Z'),
      toFake: ['Date'],
    });
    const soon = new Date('2026-10-25T08:00:00Z');
    renderIn(
      <DoneSummary
        progress={{ ...PROGRESS, due: 0, nextDue: soon }}
        standing={{ kind: 'laterToday', next: soon }}
        counts={REVIEW}
      />,
    );
    expect(screen.getByText('Next review: in 10 min')).toBeDefined();
    expect(screen.queryByText(T.dayDone)).toBeNull();
  });

  it('says plainly that today’s review is done, then when the next one is, in Vilnius time (#319)', () => {
    vi.useFakeTimers({
      now: new Date('2026-10-25T07:00:00Z'),
      toFake: ['Date'],
    });
    renderIn(
      <DoneSummary
        progress={{ ...PROGRESS, due: 0 }}
        standing={{ kind: 'dayDone', next: NEXT }}
        counts={REVIEW}
      />,
    );
    expect(screen.getByText(T.dayDone)).toBeDefined();
    expect(screen.getByText('Next review: tomorrow at 10:00')).toBeDefined();
  });

  it('leaves the next review out when none is scheduled', () => {
    renderIn(
      <DoneSummary
        progress={{ reviewed: 0, due: 0, toLearn: 4, nextDue: null }}
        standing={{ kind: 'dayDone', next: null }}
        counts={REVIEW}
      />,
    );
    expect(screen.getByText(T.dayDone)).toBeDefined();
    expect(screen.queryByText(/^Next review:/)).toBeNull();
    expect(screen.getByText('0 learned · 0 due · 4 to learn')).toBeDefined();
  });

  it('draws the progress bar on a border-toned track, visible on the dark page', () => {
    const { container } = renderIn(<DoneSummary {...DUE} counts={REVIEW} />);
    const track = container.querySelector('.bg-learned')?.parentElement;
    expect(track?.classList).toContain('bg-border');
    expect(track?.classList).not.toContain('bg-sunken');
  });
});

const LINKS = {
  back: '/repertoires/r1',
  learn: '/training?mode=learn',
  review: '/training?mode=review',
};

/** The done summary's buttons for `offer`, with `onContinue`. */
const renderActions = (
  offer: Partial<DoneOffer> = {},
  onContinue: () => void = vi.fn(),
) =>
  renderIn(
    <DoneActions
      offer={{ ...NOTHING_MORE, ...offer }}
      links={LINKS}
      onContinue={onContinue}
    />,
  );

describe('the done summary’s buttons', () => {
  it('offers Continue only when more items exist', () => {
    const { unmount } = renderActions();
    expect(screen.queryByRole('button', { name: T.continue })).toBeNull();
    unmount();
    const more = vi.fn();
    renderActions({ continue: true }, more);
    fireEvent.click(screen.getByRole('button', { name: T.continue }));
    expect(more).toHaveBeenCalledOnce();
  });

  it('offers new moves only while the allowance is left, and leads back', () => {
    const { unmount } = renderActions();
    expect(screen.queryByRole('link', { name: T.learn })).toBeNull();
    expect(
      screen.getByRole('link', { name: T.done }).getAttribute('href'),
    ).toBe('/repertoires/r1');
    unmount();
    renderActions({ learn: true });
    expect(
      screen.getByRole('link', { name: T.learn }).getAttribute('href'),
    ).toBe('/training?mode=learn');
  });

  it('offers to start review when the drill offers it, before Done', () => {
    const { unmount } = renderActions();
    expect(screen.queryByRole('link', { name: T.review })).toBeNull();
    unmount();
    renderActions({ review: true });
    expect(
      screen.getByRole('link', { name: T.review }).getAttribute('href'),
    ).toBe('/training?mode=review');
    expect(actionNames()).toEqual([T.review, T.done]);
  });

  it('puts the one next step first and Done last, quiet beside it', () => {
    renderActions({ continue: true, learn: true });
    expect(actionNames()).toEqual([T.continue, T.learn, T.done]);
    const main = screen.getByRole('button', { name: T.continue }).className;
    expect(main).toContain('bg-accent ');
    expect(main).toContain('basis-full');
    const learn = screen.getByRole('link', { name: T.learn }).className;
    expect(learn).toContain('bg-accent-subtle');
    expect(learn).not.toContain('basis-full');
    const done = screen.getByRole('link', { name: T.done }).className;
    expect(done).toContain('text-fg-muted');
    expect(done).not.toContain('bg-accent');
  });

  it('makes Done the main button when nothing else is offered', () => {
    renderActions();
    const done = screen.getByRole('link', { name: T.done }).className;
    expect(done).toContain('bg-accent ');
    expect(done).toContain('basis-full');
    expect(done).not.toContain('text-fg-muted');
  });
});
