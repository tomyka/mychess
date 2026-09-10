import { describe, it, expect } from 'vitest';
import { buildTournamentFilters, DEFAULT_PAGE_SIZE } from './query';

describe('buildTournamentFilters', () => {
  it('defaults: all statuses, all time controls, Lithuania only, page 1', () => {
    const f = buildTournamentFilters({});
    expect(f.status).toEqual(['NOT_STARTED', 'IN_PROGRESS', 'FINISHED']);
    expect(f.timeControl).toEqual(['STANDARD', 'RAPID', 'BLITZ', 'UNKNOWN']);
    expect(f.country).toEqual(['Lithuania']);
    expect(f.page).toBe(1);
    expect(f.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it('parses status filter', () => {
    const f = buildTournamentFilters({ status: 'NOT_STARTED,IN_PROGRESS' });
    expect(f.status).toEqual(['NOT_STARTED', 'IN_PROGRESS']);
  });

  it('trims whitespace from comma-separated status values', () => {
    const f = buildTournamentFilters({ status: 'NOT_STARTED, IN_PROGRESS' });
    expect(f.status).toEqual(['NOT_STARTED', 'IN_PROGRESS']);
  });

  it('falls back to all statuses when all status tokens are invalid', () => {
    const f = buildTournamentFilters({ status: 'GARBAGE,INVALID' });
    expect(f.status).toEqual(['NOT_STARTED', 'IN_PROGRESS', 'FINISHED']);
  });

  it('filters out invalid status enum values', () => {
    const f = buildTournamentFilters({ status: 'NOT_STARTED,GARBAGE' });
    expect(f.status).toEqual(['NOT_STARTED']);
  });

  it('parses timeControl filter', () => {
    const f = buildTournamentFilters({ timeControl: 'RAPID,BLITZ' });
    expect(f.timeControl).toEqual(['RAPID', 'BLITZ']);
  });

  it('trims whitespace from comma-separated timeControl values', () => {
    const f = buildTournamentFilters({ timeControl: 'RAPID, BLITZ' });
    expect(f.timeControl).toEqual(['RAPID', 'BLITZ']);
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

  it('accepts valid date range', () => {
    const f = buildTournamentFilters({ dateStart: '2026-06-01', dateEnd: '2026-08-31' });
    expect(f.dateStart).toBe('2026-06-01');
    expect(f.dateEnd).toBe('2026-08-31');
  });

  it('rejects invalid dateEnd string to prevent RangeError crash', () => {
    const f = buildTournamentFilters({ dateEnd: 'not-a-date' });
    expect(f.dateEnd).toBeUndefined();
  });

  it('rejects invalid dateStart string', () => {
    const f = buildTournamentFilters({ dateStart: '2026/06/01' });
    expect(f.dateStart).toBeUndefined();
  });

  it('accepts partial date filter (only dateStart)', () => {
    const f = buildTournamentFilters({ dateStart: '2026-06-01' });
    expect(f.dateStart).toBe('2026-06-01');
    expect(f.dateEnd).toBeUndefined();
  });
});
