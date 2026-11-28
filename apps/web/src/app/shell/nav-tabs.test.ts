import { describe, expect, it } from 'vitest';
import {
  activeTab,
  dueBadge,
  isTabRoot,
  navTabs,
  phoneMenuIn,
  settingsBack,
} from './nav-tabs';

describe('navTabs', () => {
  it('gives a player Today, Repertoires and Opponents', () => {
    expect(navTabs({ isCoach: false }).map((t) => [t.id, t.href])).toEqual([
      ['today', '/'],
      ['repertoires', '/repertoires'],
      ['opponents', '/fide'],
    ]);
  });

  it('adds Coach last for a coach', () => {
    expect(navTabs({ isCoach: true }).map((t) => t.id)).toEqual([
      'today',
      'repertoires',
      'opponents',
      'coach',
    ]);
  });
});

describe('activeTab', () => {
  it.each([
    ['/', 'today'],
    ['/repertoires', 'repertoires'],
    ['/repertoires/import', 'repertoires'],
    ['/repertoires/assigned/abc', 'repertoires'],
    ['/fide', 'opponents'],
    ['/coach', 'coach'],
    ['/coach/players/p1/progress/r1', 'coach'],
  ] as const)('%s is %s', (path, tab) => {
    expect(activeTab(path)).toBe(tab);
  });

  it.each(['/settings', '/training', '/repertoiresx', '/coaching'])(
    '%s belongs to no tab',
    (path) => {
      expect(activeTab(path)).toBeNull();
    },
  );
});

describe('isTabRoot', () => {
  it.each(['/', '/repertoires', '/fide', '/coach'])('%s is a tab', (path) => {
    expect(isTabRoot(path)).toBe(true);
  });

  it.each(['/settings', '/repertoires/import', '/coach/groups/g1'])(
    '%s is an inner page',
    (path) => {
      expect(isTabRoot(path)).toBe(false);
    },
  );
});

describe('settingsBack (#400)', () => {
  it.each([
    ['today', false, 'today', '/'],
    ['repertoires', false, 'repertoires', '/repertoires'],
    ['opponents', false, 'opponents', '/fide'],
    ['coach', true, 'coach', '/coach'],
    // A player has no Coach tab to go back to.
    ['coach', false, 'today', '/'],
    [undefined, true, 'today', '/'],
    ['toString', true, 'today', '/'],
    [['coach'], true, 'today', '/'],
  ] as const)(
    'from=%j, coach %s, goes back to %s',
    (from, isCoach, id, href) => {
      expect(settingsBack(from, { isCoach })).toEqual({ id, href });
    },
  );
});

describe('phoneMenuIn (#400)', () => {
  it.each(['/', '/repertoires', '/fide', '/coach'])(
    'a tab’s own page carries it in the top bar (%s)',
    (path) => {
      expect(phoneMenuIn(path)).toBe('topBar');
    },
  );

  it.each(['/settings', '/repertoires/import', '/no-such-page', '/coach/x'])(
    'any other page carries it in its own header (%s), the 404 too',
    (path) => {
      expect(phoneMenuIn(path)).toBe('header');
    },
  );
});

describe('dueBadge', () => {
  it('shows nothing when nothing is due', () => {
    expect(dueBadge(0)).toBeNull();
  });

  it('shows the count up to 99, then 99+', () => {
    expect(dueBadge(1)).toBe('1');
    expect(dueBadge(99)).toBe('99');
    expect(dueBadge(100)).toBe('99+');
  });
});
