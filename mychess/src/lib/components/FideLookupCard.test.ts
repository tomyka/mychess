// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
import { goto } from '$app/navigation';

import FideLookupCard from './FideLookupCard.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const player = {
  fideId: '1503014',
  name: 'Carlsen, Magnus',
  stdRating: 2839, rapidRating: 2828, blitzRating: 2887,
  countryRankStandard: 1, countryRankRapid: 2, countryRankBlitz: 3,
  ageBracket: 'U18', ageGroupRankStandard: 4, ageGroupRankRapid: 5, ageGroupRankBlitz: 6,
  europeAgeGroupRankStandard: 7, europeAgeGroupRankRapid: 8, europeAgeGroupRankBlitz: 9
};

const noBirthYear = {
  fideId: '9999999',
  name: 'No Birthday',
  stdRating: 1500, rapidRating: null, blitzRating: null,
  countryRankStandard: 10, countryRankRapid: null, countryRankBlitz: null,
  ageBracket: null, ageGroupRankStandard: null, ageGroupRankRapid: null, ageGroupRankBlitz: null,
  europeAgeGroupRankStandard: null, europeAgeGroupRankRapid: null, europeAgeGroupRankBlitz: null
};

describe('FideLookupCard', () => {
  it('renders the FIDE id input', () => {
    render(FideLookupCard, { props: { query: '', result: null } });
    expect(screen.getByLabelText(/FIDE ID/i)).toBeTruthy();
  });

  it('shows the FIDE ID next to the name in the result heading', () => {
    render(FideLookupCard, { props: { query: '1503014', result: { found: true, player } } });
    expect(screen.getByText('Carlsen, Magnus')).toBeTruthy();
    expect(screen.getByText('(1503014)')).toBeTruthy();
  });

  it('shows ratings for all three chess types', () => {
    render(FideLookupCard, { props: { query: '1503014', result: { found: true, player } } });
    expect(screen.getByText('Carlsen, Magnus')).toBeTruthy();
    expect(screen.getByText('2839')).toBeTruthy();
    expect(screen.getByText('2828')).toBeTruthy();
    expect(screen.getByText('2887')).toBeTruthy();
  });

  it('shows national rank for all three types', () => {
    render(FideLookupCard, { props: { query: '1503014', result: { found: true, player } } });
    expect(screen.getByText('#1')).toBeTruthy();
    expect(screen.getByText('#2')).toBeTruthy();
    expect(screen.getByText('#3')).toBeTruthy();
  });

  it('shows the age-group rank row labelled with the bracket', () => {
    render(FideLookupCard, { props: { query: '1503014', result: { found: true, player } } });
    expect(screen.getByText(/^U18 rank$/i)).toBeTruthy();
    expect(screen.getByText('#4')).toBeTruthy();
    expect(screen.getByText('#5')).toBeTruthy();
    expect(screen.getByText('#6')).toBeTruthy();
  });

  it('shows the Europe age-group rank row labelled with the bracket', () => {
    render(FideLookupCard, { props: { query: '1503014', result: { found: true, player } } });
    expect(screen.getByText(/U18 rank \(Europe\)/i)).toBeTruthy();
    expect(screen.getByText('#7')).toBeTruthy();
    expect(screen.getByText('#8')).toBeTruthy();
    expect(screen.getByText('#9')).toBeTruthy();
  });

  it('omits both age-group rows when the bracket is unknown', () => {
    render(FideLookupCard, { props: { query: '9', result: { found: true, player: noBirthYear } } });
    expect(screen.getByText('#10')).toBeTruthy(); // national rank row still present
    expect(screen.queryByText(/U\d+ rank|Age group rank/i)).toBeNull();
  });

  it('shows a not-found message when the id has no record', () => {
    render(FideLookupCard, { props: { query: '999', result: { found: false } } });
    expect(screen.getByText(/No FIDE record/i)).toBeTruthy();
  });

  it('shows a dropdown of name matches and navigates to the selected player', async () => {
    global.fetch = vi.fn(async () => ({
      json: async () => ({ results: [{ fideId: '1503014', name: 'Carlsen, Magnus', federation: 'NOR' }] })
    })) as any;

    render(FideLookupCard, { props: { query: '', result: null } });
    await fireEvent.input(screen.getByLabelText(/FIDE ID/i), { target: { value: 'Carlsen' } });

    const item = await screen.findByText(/Carlsen, Magnus/); // waits through debounce + fetch
    await fireEvent.click(item);
    expect(goto).toHaveBeenCalledWith('/?fide=1503014');
  });

  it('shows each match\'s FIDE ID in brackets next to their name', async () => {
    global.fetch = vi.fn(async () => ({
      json: async () => ({ results: [{ fideId: '1503014', name: 'Carlsen, Magnus', federation: 'NOR' }] })
    })) as any;

    render(FideLookupCard, { props: { query: '', result: null } });
    await fireEvent.input(screen.getByLabelText(/FIDE ID/i), { target: { value: 'Carlsen' } });

    expect(await screen.findByText('Carlsen, Magnus (1503014)')).toBeTruthy();
  });
});
