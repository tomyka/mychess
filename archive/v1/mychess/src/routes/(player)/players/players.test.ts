// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import PlayersPage from './+page.svelte';

afterEach(() => cleanup());

describe('players page', () => {
  it('renders the FIDE lookup card', () => {
    render(PlayersPage, { props: { data: { fideQuery: '', fideLookup: null } } });
    expect(screen.getByLabelText(/FIDE ID/i)).toBeTruthy();
  });

  it('shows a result when one was loaded server-side', () => {
    const fideLookup = {
      found: true,
      player: {
        fideId: '1503014',
        name: 'Carlsen, Magnus',
        stdRating: 2839, rapidRating: 2828, blitzRating: 2887,
        countryRankStandard: 1, countryRankRapid: 1, countryRankBlitz: 1,
        ageBracket: null,
        ageGroupRankStandard: null, ageGroupRankRapid: null, ageGroupRankBlitz: null,
        europeAgeGroupRankStandard: null, europeAgeGroupRankRapid: null, europeAgeGroupRankBlitz: null
      }
    };
    render(PlayersPage, { props: { data: { fideQuery: '1503014', fideLookup } } });
    expect(screen.getByText('Carlsen, Magnus')).toBeTruthy();
    expect(screen.getByText('(1503014)')).toBeTruthy();
  });

  it('links back to the dashboard', () => {
    render(PlayersPage, { props: { data: { fideQuery: '', fideLookup: null } } });
    expect(screen.getByRole('link', { name: /Back to Dashboard/i }).getAttribute('href')).toBe('/');
  });
});
