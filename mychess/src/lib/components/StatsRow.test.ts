// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import StatsRow from './StatsRow.svelte';

afterEach(() => cleanup());

describe('StatsRow', () => {
  it('shows the country rank number when provided', () => {
    render(StatsRow, { props: { countryRank: 42 } });
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Country rank')).toBeTruthy();
  });

  it('shows a dash for country rank when null', () => {
    render(StatsRow, { props: { countryRank: null } });
    expect(screen.getAllByText('––').length).toBeGreaterThan(0);
  });

  it('labels the age-group tile with the bracket when known', () => {
    render(StatsRow, { props: { ageGroupRank: 3, ageBracket: 'U12' } });
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('U12 rank')).toBeTruthy();
  });

  it('uses a generic label for the open bracket', () => {
    render(StatsRow, { props: { ageGroupRank: 5, ageBracket: 'open' } });
    expect(screen.getByText('Age group rank')).toBeTruthy();
  });
});
