import { describe, expect, it } from 'vitest';
import { accountLinks } from './account-links';

describe('the account menu links (#381 part 6)', () => {
  it.each([
    ['/', 'today'],
    ['/repertoires', 'repertoires'],
    ['/repertoires/r-1/manage', 'repertoires'],
    ['/fide', 'opponents'],
    ['/coach', 'coach'],
    ['/coach/players/p-1', 'coach'],
    ['/settings', 'today'],
    ['/training', 'today'],
    ['/repertoiresque', 'today'],
  ])('from %s carry ?from=%s', (path, from) => {
    expect(accountLinks(path)).toEqual({
      settings: `/settings?from=${from}`,
      myCoaches: `/settings?from=${from}#coaches`,
    });
  });
});
