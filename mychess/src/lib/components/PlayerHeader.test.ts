// mychess/src/lib/components/PlayerHeader.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import PlayerHeader from './PlayerHeader.svelte';

afterEach(() => cleanup());

const FULL_RATINGS = {
  standard: { rating: 1842, countryRank: 12, ageGroupRank: 3, europeAgeGroupRank: 210 },
  rapid: { rating: 1790, countryRank: 18, ageGroupRank: 5, europeAgeGroupRank: 340 },
  blitz: { rating: 1705, countryRank: 24, ageGroupRank: 7, europeAgeGroupRank: 410 }
};

describe('PlayerHeader', () => {
  it('shows the link-FIDE prompt and no rating tiles when there is no FIDE ID', () => {
    render(PlayerHeader, { props: { profile: { display_name: 'Tomas' }, fideRatings: null } });
    expect(screen.getByText('Link FIDE account →')).toBeTruthy();
    expect(screen.queryByText('Standard')).toBeNull();
  });

  it('derives initials from first_name/last_name when both are set', () => {
    render(PlayerHeader, {
      props: {
        profile: { display_name: 'Tomas Konovalovas', first_name: 'Tomas', last_name: 'Konovalovas' },
        fideRatings: null
      }
    });
    expect(screen.getByText('TK')).toBeTruthy();
  });

  it('falls back to display_name-based initials when first_name/last_name are missing', () => {
    render(PlayerHeader, { props: { profile: { display_name: 'Tomas' }, fideRatings: null } });
    expect(screen.getByText('TO')).toBeTruthy();
  });

  it('shows all three tiles with real numbers when fully rated', () => {
    render(PlayerHeader, {
      props: { profile: { display_name: 'Tomas', fide_id: '1503014' }, fideRatings: FULL_RATINGS }
    });
    expect(screen.getByText('1842')).toBeTruthy();
    expect(screen.getByText('#12')).toBeTruthy();
    expect(screen.getByText('#3')).toBeTruthy();
    expect(screen.getByText('#210')).toBeTruthy();
    expect(screen.getByText('1790')).toBeTruthy();
    expect(screen.getByText('#18')).toBeTruthy();
    expect(screen.getByText('#5')).toBeTruthy();
    expect(screen.getByText('#340')).toBeTruthy();
    expect(screen.getByText('1705')).toBeTruthy();
    expect(screen.getByText('#24')).toBeTruthy();
    expect(screen.getByText('#7')).toBeTruthy();
    expect(screen.getByText('#410')).toBeTruthy();
  });

  it('shows a dash and N/A for a variant with no rating', () => {
    const ratings = {
      ...FULL_RATINGS,
      blitz: { rating: null, countryRank: null, ageGroupRank: null, europeAgeGroupRank: null }
    };
    render(PlayerHeader, {
      props: { profile: { display_name: 'Tomas', fide_id: '1503014' }, fideRatings: ratings }
    });
    expect(screen.getByText('1842')).toBeTruthy();
    expect(screen.getByText('1790')).toBeTruthy();
    expect(screen.getAllByText('–').length).toBe(1);
    expect(screen.getAllByText('N/A').length).toBe(3);
  });

  it('shows placeholders in all three tiles when fideRatings is null but a FIDE ID exists', () => {
    render(PlayerHeader, {
      props: { profile: { display_name: 'Tomas', fide_id: '1503014' }, fideRatings: null }
    });
    expect(screen.getAllByText('–').length).toBe(3);
    expect(screen.getAllByText('N/A').length).toBe(9);
    expect(screen.getByText('FIDE ID: 1503014')).toBeTruthy();
  });
});
