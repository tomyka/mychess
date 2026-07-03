// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import FideLookupCard from './FideLookupCard.svelte';

afterEach(() => cleanup());

const player = {
  name: 'Konovalovas, Tomas',
  stdRating: null, rapidRating: 1663, blitzRating: 1530,
  countryRankStandard: null, ageBracket: 'open', ageGroupRankStandard: null
};

describe('FideLookupCard', () => {
  it('renders the FIDE id input', () => {
    render(FideLookupCard, { props: { query: '', result: null } });
    expect(screen.getByLabelText(/FIDE ID/i)).toBeTruthy();
  });
  it('shows the player name and ratings when a result is found', () => {
    render(FideLookupCard, { props: { query: '12865168', result: { found: true, player } } });
    expect(screen.getByText('Konovalovas, Tomas')).toBeTruthy();
    expect(screen.getByText('1663')).toBeTruthy();
  });
  it('shows a not-found message when the id has no record', () => {
    render(FideLookupCard, { props: { query: '999', result: { found: false } } });
    expect(screen.getByText(/No FIDE record/i)).toBeTruthy();
  });
});
