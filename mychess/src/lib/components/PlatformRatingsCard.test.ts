// mychess/src/lib/components/PlatformRatingsCard.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import PlatformRatingsCard from './PlatformRatingsCard.svelte';

afterEach(() => cleanup());

describe('PlatformRatingsCard', () => {
  it('shows a connect prompt when not connected', () => {
    render(PlatformRatingsCard, { props: { platform: 'Lichess', username: null, ratings: null } });
    expect(screen.getByText(/Connect Lichess/i)).toBeTruthy();
  });

  it('shows an error message when the fetch failed', () => {
    render(PlatformRatingsCard, { props: { platform: 'Chess.com', username: 'magnus', ratings: null } });
    expect(screen.getByText(/Couldn't load Chess\.com stats/i)).toBeTruthy();
  });

  it('shows a loading skeleton instead of an error while streaming in', () => {
    render(PlatformRatingsCard, { props: { platform: 'Chess.com', username: 'magnus', ratings: null, loading: true } });
    expect(screen.queryByText(/Couldn't load Chess\.com stats/i)).toBeNull();
    expect(screen.getByLabelText('Loading Chess.com ratings')).toBeTruthy();
  });

  it('shows a no-rated-games message when ratings is empty', () => {
    render(PlatformRatingsCard, { props: { platform: 'Lichess', username: 'magnus', ratings: {} } });
    expect(screen.getByText(/No rated games yet/i)).toBeTruthy();
  });

  it('shows the platform and username header line when connected', () => {
    render(PlatformRatingsCard, {
      props: { platform: 'Lichess', username: 'DrNykterstein', ratings: { rapid: 2700 } }
    });
    expect(screen.getByText(/Lichess/)).toBeTruthy();
    expect(screen.getByText('DrNykterstein')).toBeTruthy();
  });

  it('shows a tile per available variant', () => {
    render(PlatformRatingsCard, {
      props: { platform: 'Chess.com', username: 'magnus', ratings: { puzzle: 2830, blitz: 2800 } }
    });
    expect(screen.getByText('2800')).toBeTruthy();
    expect(screen.getByText('Blitz')).toBeTruthy();
    expect(screen.getByText('2830')).toBeTruthy();
    expect(screen.getByText('Puzzles')).toBeTruthy();
  });

  it('shows all four variants in rapid/blitz/bullet/puzzle order regardless of input order', () => {
    render(PlatformRatingsCard, {
      props: {
        platform: 'Lichess',
        username: 'magnus',
        ratings: { puzzle: 2400, bullet: 2500, blitz: 2600, rapid: 2700 }
      }
    });
    const labels = screen.getAllByText(/^(Rapid|Blitz|Bullet|Puzzles)$/).map((el) => el.textContent);
    expect(labels).toEqual(['Rapid', 'Blitz', 'Bullet', 'Puzzles']);
  });
});
