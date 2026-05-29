import { describe, it, expect } from 'vitest';
import { buildTournamentFilters, DEFAULT_PAGE_SIZE } from './query';

describe('buildTournamentFilters', () => {
  it('defaults: all statuses, all time controls, both countries, page 1', () => {
    const f = buildTournamentFilters({});
    expect(f.status).toEqual(['NOT_STARTED', 'IN_PROGRESS', 'FINISHED']);
    expect(f.timeControl).toEqual(['STANDARD', 'RAPID', 'BLITZ', 'UNKNOWN']);
    expect(f.country).toEqual(['Lithuania', 'Latvia']);
    expect(f.page).toBe(1);
    expect(f.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it('parses status filter', () => {
    const f = buildTournamentFilters({ status: 'NOT_STARTED,IN_PROGRESS' });
    expect(f.status).toEqual(['NOT_STARTED', 'IN_PROGRESS']);
  });

  it('parses country filter', () => {
    const f = buildTournamentFilters({ country: 'Lithuania' });
    expect(f.country).toEqual(['Lithuania']);
  });

  it('parses page number', () => {
    const f = buildTournamentFilters({ page: '3' });
    expect(f.page).toBe(3);
  });

  it('clamps invalid page to 1', () => {
    const f = buildTournamentFilters({ page: '-1' });
    expect(f.page).toBe(1);
    const f2 = buildTournamentFilters({ page: 'abc' });
    expect(f2.page).toBe(1);
  });

  it('accepts date range', () => {
    const f = buildTournamentFilters({ dateStart: '2026-06-01', dateEnd: '2026-08-31' });
    expect(f.dateStart).toBe('2026-06-01');
    expect(f.dateEnd).toBe('2026-08-31');
  });
});
