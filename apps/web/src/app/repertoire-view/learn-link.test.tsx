import { lines } from '@mychess/chess';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import { LearnLink } from './learn-link';
import type { PanelTraining } from './train-buttons';

const london = graphOf(LONDON);
const chapterId = london.chapters[0]?.id ?? '';
const LINES = lines(london, chapterId).length;

const training = (learnedToday: number): PanelTraining => ({
  repertoireId: 'r1',
  counts: { due: 0, toLearn: 2 },
  learn: {
    tracked: [],
    learnedToday,
    limits: { reviews: 20, newPerDay: 2 },
  },
  limitReached: false,
});

function renderLink(
  learnedToday: number,
  focus: { chapterId: string; lineIndex?: number },
  subject?: string,
) {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <LearnLink
        training={training(learnedToday)}
        graph={london}
        focus={focus}
        {...(subject === undefined ? {} : { subject })}
      />
    </NextIntlClientProvider>,
  );
}

describe('LearnLink (R-206)', () => {
  it('links to learning the chapter, with its count', () => {
    renderLink(0, { chapterId }, 'Main');
    const link = screen.getByRole('link', {
      name: 'Learn 2 new moves in Main',
    });
    expect(link.getAttribute('href')).toBe(
      `/treniruote?mode=learn&r=r1&chapter=${chapterId}`,
    );
    expect(link.textContent).toBe('Learn (2)');
  });

  it('counts what is left of today’s new moves', () => {
    renderLink(1, { chapterId }, 'Main');
    expect(
      screen.getByRole('link', { name: 'Learn 1 new move in Main' })
        .textContent,
    ).toBe('Learn (1)');
  });

  it('links to learning the current line, named as this line', () => {
    expect(LINES).toBeGreaterThan(1);
    renderLink(0, { chapterId, lineIndex: 1 });
    const link = screen.getByRole('link', {
      name: 'Learn 2 new moves in this line',
    });
    expect(link.getAttribute('href')).toBe(
      `/treniruote?mode=learn&r=r1&chapter=${chapterId}&line=1`,
    );
  });

  it('is hidden when learning it would teach nothing today', () => {
    renderLink(2, { chapterId }, 'Main');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('is hidden for a line with no new move', () => {
    renderLink(0, { chapterId, lineIndex: LINES + 5 });
    expect(screen.queryByRole('link')).toBeNull();
  });
});
