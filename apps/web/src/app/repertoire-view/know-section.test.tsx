import { lines } from '@mychess/chess';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/locales';
import { KnowSection } from './know-section';

vi.mock('../repertuarai/know-actions', () => ({
  knowCountAction: vi.fn(),
  markKnownAction: vi.fn(),
  learnAgainAction: vi.fn(),
}));

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const lt = MESSAGES.lt.training.know;
const london = graphOf(LONDON);
const chapterId = london.chapters[0]?.id ?? 'c1';
const [, c5 = []] = lines(london, chapterId);

function renderSection(depth: number): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <KnowSection
        training={{ repertoireId: ID, counts: { due: 0, toLearn: 0 } }}
        graph={london}
        chapterId={chapterId}
        path={c5.slice(0, depth)}
      />
    </NextIntlClientProvider>,
  );
}

const toggleFor = (subject: string) =>
  screen.queryByRole('button', {
    name: lt.toggle.replace('{subject}', subject),
  });

describe('KnowSection (R-58)', () => {
  it('offers the selected own move and the line it is on', () => {
    // 1. d4 d5 2. Bf4 Nf6 3. e3: White's own move.
    renderSection(5);
    expect(screen.getByText('Šis ėjimas: 3. e3')).toBeDefined();
    expect(toggleFor('Šis ėjimas: 3. e3')).not.toBeNull();
    expect(toggleFor(lt.line)).not.toBeNull();
  });

  it('has no move menu on an opponent move, only the line', () => {
    // 3...c5 is Black's: not a move the White player trains.
    renderSection(6);
    expect(screen.queryByText(/Šis ėjimas/)).toBeNull();
    expect(screen.getAllByRole('button').length).toBe(1);
    expect(toggleFor(lt.line)).not.toBeNull();
  });

  it('shows nothing at the chapter root', () => {
    renderSection(0);
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryByText(lt.section)).toBeNull();
  });
});
