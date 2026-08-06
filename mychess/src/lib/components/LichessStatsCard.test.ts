// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import LichessStatsCard from './LichessStatsCard.svelte';

afterEach(() => cleanup());

describe('LichessStatsCard', () => {
  it('shows a connect prompt when not connected', () => {
    render(LichessStatsCard, { props: { username: null, ratings: null } });
    expect(screen.getByText(/Connect Lichess/i)).toBeTruthy();
  });

  it('shows an error message when the fetch failed', () => {
    render(LichessStatsCard, { props: { username: 'magnus', ratings: null } });
    expect(screen.getByText(/Couldn't load Lichess stats/i)).toBeTruthy();
  });

  it('shows a no-rated-games message when ratings is empty', () => {
    render(LichessStatsCard, { props: { username: 'magnus', ratings: {} } });
    expect(screen.getByText(/No rated games yet/i)).toBeTruthy();
  });

  it('shows a badge per available variant, in a fixed order', () => {
    render(LichessStatsCard, {
      props: { username: 'magnus', ratings: { classical: 2830, blitz: 2800 } }
    });
    expect(screen.getByText('2800')).toBeTruthy();
    expect(screen.getByText('Blitz')).toBeTruthy();
    expect(screen.getByText('2830')).toBeTruthy();
    expect(screen.getByText('Classical')).toBeTruthy();
  });

  it('compact mode shows only the highest-priority rating (blitz > rapid > classical > bullet)', () => {
    render(LichessStatsCard, {
      props: { username: 'magnus', ratings: { rapid: 2750, classical: 2830 }, compact: true }
    });
    expect(screen.getByText('2750')).toBeTruthy();
    expect(screen.queryByText('2830')).toBeNull();
  });

  it('compact mode falls back through the priority chain when higher variants are missing', () => {
    render(LichessStatsCard, {
      props: { username: 'magnus', ratings: { bullet: 2900 }, compact: true }
    });
    expect(screen.getByText('2900')).toBeTruthy();
    expect(screen.getByText('Bullet')).toBeTruthy();
  });

  it('compact mode shows the no-rated-games message when ratings is empty', () => {
    render(LichessStatsCard, {
      props: { username: 'magnus', ratings: {}, compact: true }
    });
    expect(screen.getByText(/No rated games yet/i)).toBeTruthy();
  });
});
