import { lines } from '@mychess/chess';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import { KnowSection } from './know-section';
import { panelTraining } from './test-training';

vi.mock('../repertoires/know-actions', () => ({
  knowCountAction: vi.fn(),
  markKnownAction: vi.fn(),
  learnAgainAction: vi.fn(),
}));

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const know = MESSAGES.training.know;
const london = graphOf(LONDON);
const chapterId = london.chapters[0]?.id ?? 'c1';
const [, c5 = []] = lines(london, chapterId);

function renderSection(depth: number, learnedToday = 10): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <KnowSection
        training={panelTraining({
          repertoireId: ID,
          learn: {
            tracked: [],
            learnedToday,
            limits: { reviews: 20, newPerDay: 10 },
          },
        })}
        graph={london}
        chapterId={chapterId}
        path={c5.slice(0, depth)}
      />
    </NextIntlClientProvider>,
  );
}

const toggleFor = (subject: string) =>
  screen.queryByRole('button', {
    name: know.toggle.replace('{subject}', subject),
  });

describe('KnowSection (R-58)', () => {
  it('offers the selected own move and the line it is on', () => {
    // 1. d4 d5 2. Bf4 Nf6 3. e3: White's own move.
    renderSection(5);
    expect(screen.getByText('This move: 3. e3')).toBeDefined();
    expect(toggleFor('This move: 3. e3')).not.toBeNull();
    expect(toggleFor(know.line)).not.toBeNull();
  });

  it('has no move menu on an opponent move, only the line', () => {
    // 3...c5 is Black's: not a move the White player trains.
    renderSection(6);
    expect(screen.queryByText(/This move/)).toBeNull();
    expect(screen.getAllByRole('button').length).toBe(1);
    expect(toggleFor(know.line)).not.toBeNull();
  });

  it('shows nothing at the chapter root', () => {
    renderSection(0, 0);
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.queryByText(know.section)).toBeNull();
  });
});

describe('KnowSection’s Learn on the current line (R-206)', () => {
  it('links to learning the line the current move is on', () => {
    renderSection(6, 0);
    const link = screen.getByRole('link', {
      name: /^Learn \d+ new moves in this line$/,
    });
    expect(link.getAttribute('href')).toBe(
      `/training?mode=learn&r=${ID}&chapter=${chapterId}&line=1`,
    );
  });

  it('has no Learn once today’s new moves are used', () => {
    renderSection(6, 10);
    expect(screen.queryAllByRole('link')).toEqual([]);
  });
});
