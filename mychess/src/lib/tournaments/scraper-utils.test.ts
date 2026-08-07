import { describe, it, expect } from 'vitest';
import {
  parseTimeControl,
  parseStatusFromClass,
  parseTournamentDetailField,
  parseDateFromName,
  SUPPORTED_FEDERATIONS,
} from './scraper-utils';

describe('parseTimeControl', () => {
  it('parses Standard time control', () => {
    expect(parseTimeControl('St')).toBe('STANDARD');
  });
  it('parses Rapid time control', () => {
    expect(parseTimeControl('Rp')).toBe('RAPID');
  });
  it('parses Blitz time control', () => {
    expect(parseTimeControl('Bz')).toBe('BLITZ');
  });
  it('returns UNKNOWN for unrecognized codes', () => {
    expect(parseTimeControl('XX')).toBe('UNKNOWN');
    expect(parseTimeControl('')).toBe('UNKNOWN');
  });
});

describe('parseStatusFromClass', () => {
  it('returns FINISHED for p_18', () => {
    expect(parseStatusFromClass('p_18')).toBe('FINISHED');
  });
  it('returns IN_PROGRESS for p_17', () => {
    expect(parseStatusFromClass('p_17')).toBe('IN_PROGRESS');
  });
  it('returns NOT_STARTED for p_5', () => {
    expect(parseStatusFromClass('p_5')).toBe('NOT_STARTED');
  });
  it('returns NOT_STARTED for unknown class', () => {
    expect(parseStatusFromClass('')).toBe('NOT_STARTED');
  });
});

describe('parseDateFromName', () => {
  it('extracts city and ISO start date', () => {
    const r = parseDateFromName('Vilnius Open (Vilnius, 2026-06-07)');
    expect(r.city).toBe('Vilnius');
    expect(r.startDate).toEqual(new Date('2026-06-07'));
  });

  it('falls back to a short dd-mm date in the current year', () => {
    const year = new Date().getFullYear();
    const r = parseDateFromName('Kaunas Rapid (Kaunas, 06-07)');
    expect(r.city).toBe('Kaunas');
    expect(r.startDate).toEqual(new Date(`${year}-06-07`));
  });

  it('falls back to a day-range date in the current year', () => {
    const year = new Date().getFullYear();
    const r = parseDateFromName('Riga Open (07 06-09)');
    expect(r.startDate).toEqual(new Date(`${year}-07-06`));
  });

  it('detects a known city name even without parentheses', () => {
    const r = parseDateFromName('Šiauliai Chess Festival 2026');
    expect(r.city).toBe('Šiauliai');
  });

  it('returns no city or date when nothing matches', () => {
    const r = parseDateFromName('Untitled Tournament');
    expect(r.city).toBeUndefined();
    expect(r.startDate).toBeUndefined();
  });
});

describe('parseTournamentDetailField', () => {
  it('parses single date', () => {
    const r = parseTournamentDetailField('date', '2026/06/07');
    expect(r.startDate).toEqual(new Date('2026-06-07'));
    expect(r.endDate).toBeUndefined();
  });
  it('parses date range', () => {
    const r = parseTournamentDetailField('date', '2026/06/07 - 2026/06/10');
    expect(r.startDate).toEqual(new Date('2026-06-07'));
    expect(r.endDate).toEqual(new Date('2026-06-10'));
  });
  it('parses average rating', () => {
    const r = parseTournamentDetailField('rating-ø / average age', '1783 / 12.5');
    expect(r.averageRating).toBe(1783);
  });
  it('parses number of rounds', () => {
    const r = parseTournamentDetailField('number of rounds', '7');
    expect(r.roundCount).toBe(7);
  });
  it('parses chief arbiter', () => {
    const r = parseTournamentDetailField('chief arbiter', 'Jonas Jonaitis');
    expect(r.chiefArbiter).toBe('Jonas Jonaitis');
  });
  it('parses organizer trimming after comma', () => {
    const r = parseTournamentDetailField('organizer', 'Chess Club, Vilnius');
    expect(r.organizer).toBe('Chess Club');
  });
  it('ignores unrecognized labels', () => {
    const r = parseTournamentDetailField('tournament name', 'Vilnius Open');
    expect(Object.keys(r)).toHaveLength(0);
  });
});

describe('SUPPORTED_FEDERATIONS', () => {
  it('includes Lithuania and Latvia only', () => {
    expect(SUPPORTED_FEDERATIONS.map(f => f.code)).toEqual(['LTU', 'LAT']);
  });
  it('does not include Estonia', () => {
    expect(SUPPORTED_FEDERATIONS.map(f => f.code)).not.toContain('EST');
  });
});
