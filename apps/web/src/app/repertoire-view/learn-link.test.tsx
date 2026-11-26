import { lines } from '@mychess/chess';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import { TONAL_BUTTON } from '../buttons';
import { LearnLink } from './learn-link';
import type { TrainNow } from '../../server/training';
import { trainNow } from './test-training';

const london = graphOf(LONDON);
const chapterId = london.chapters[0]?.id ?? '';
const LINES = lines(london, chapterId).length;

const training = (learnedToday: number): TrainNow =>
  trainNow({
    repertoireId: 'r1',
    counts: { due: 0, toLearn: 2 },
    learn: {
      tracked: [],
      learnedToday,
      limits: { reviews: 20, newPerDay: 2 },
    },
  });

function renderLink(
  learnedToday: number,
  focus: { chapterId: string; lineIndex?: number },
) {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <LearnLink
        training={training(learnedToday)}
        graph={london}
        focus={focus}
      />
    </NextIntlClientProvider>,
  );
}

describe('LearnLink (R-206)', () => {
  it('links to learning the chapter, with its count, as a tonal button', () => {
    renderLink(0, { chapterId });
    const link = screen.getByRole('link', { name: 'Learn this chapter (2)' });
    expect(link.getAttribute('href')).toBe(
      `/training?mode=learn&r=r1&chapter=${chapterId}`,
    );
    expect(link.className).toBe(TONAL_BUTTON);
  });

  it('counts what is left of today’s new moves', () => {
    renderLink(1, { chapterId });
    expect(
      screen.getByRole('link', { name: 'Learn this chapter (1)' }),
    ).toBeDefined();
  });

  it('links to learning the current line, named as this line', () => {
    expect(LINES).toBeGreaterThan(1);
    renderLink(0, { chapterId, lineIndex: 1 });
    const link = screen.getByRole('link', { name: 'Learn this line (2)' });
    expect(link.getAttribute('href')).toBe(
      `/training?mode=learn&r=r1&chapter=${chapterId}&line=1`,
    );
  });

  it('is hidden when learning it would teach nothing today', () => {
    renderLink(2, { chapterId });
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('is hidden for a line with no new move', () => {
    renderLink(0, { chapterId, lineIndex: LINES + 5 });
    expect(screen.queryByRole('link')).toBeNull();
  });
});
