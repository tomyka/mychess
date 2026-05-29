import { describe, it, expect } from 'vitest';
import {
  parseTimeControl,
  parseStatusFromClass,
  deriveStatus,
  parseTournamentDetailField,
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

describe('deriveStatus', () => {
  const daysAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const daysFromNow = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  it('keeps FINISHED regardless of date', () => {
    expect(deriveStatus('FINISHED', daysAgo(1))).toBe('FINISHED');
    expect(deriveStatus('FINISHED', null)).toBe('FINISHED');
  });
  it('overrides NOT_STARTED to FINISHED when start date has passed', () => {
    expect(deriveStatus('NOT_STARTED', daysAgo(1))).toBe('FINISHED');
  });
  it('keeps NOT_STARTED when start date is today or future', () => {
    expect(deriveStatus('NOT_STARTED', daysFromNow(0))).toBe('NOT_STARTED');
    expect(deriveStatus('NOT_STARTED', daysFromNow(3))).toBe('NOT_STARTED');
  });
  it('keeps IN_PROGRESS when endDate is in the future', () => {
    expect(deriveStatus('IN_PROGRESS', daysAgo(2), daysFromNow(3))).toBe('IN_PROGRESS');
  });
  it('overrides to FINISHED when endDate has passed', () => {
    expect(deriveStatus('NOT_STARTED', daysAgo(5), daysAgo(1))).toBe('FINISHED');
  });
  it('keeps scraped status when startDate is null', () => {
    expect(deriveStatus('NOT_STARTED', null)).toBe('NOT_STARTED');
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
