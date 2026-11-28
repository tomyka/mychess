import { describe, expect, it } from 'vitest';
import {
  acceptedInvitePath,
  assignedForkRoute,
  assignedManageRoute,
  assignedRepertoirePath,
  coachGroupPath,
  coachPlayerPath,
  coachProgressPath,
  coachSharedRepertoirePath,
  importIntoRoute,
  invitePath,
  inviteTokenOf,
  learnPath,
  repertoireDeletedRoute,
  repertoireChapterRoute,
  repertoireExportRoute,
  repertoireManageRoute,
  repertoireRoute,
  ROUTES,
  myCoachesPath,
  readAssignedManageQuery,
  readImportQuery,
  readLinkedQuery,
  readRepertoireQuery,
  readRepertoiresQuery,
  readSettingsQuery,
  readTrainingQuery,
  settingsPath,
  trainingPath,
  trainingResultsRoute,
} from './routes';

describe('ROUTES', () => {
  it('names the repertoire list and the import page in English', () => {
    expect(ROUTES.repertoires).toBe('/repertoires');
    expect(ROUTES.repertoireImport).toBe('/repertoires/import');
  });

  it('names the coach dashboard and the "My coaches" section of settings', () => {
    expect(ROUTES.coach).toBe('/coach');
    expect(ROUTES.myCoaches).toBe('/settings#coaches');
  });

  it('names the training section of settings (R-205)', () => {
    expect(ROUTES.trainingSettings).toBe('/settings#training');
  });
});

describe('invitePath', () => {
  it('is /invite/ followed by the token', () => {
    expect(invitePath('abc_-1')).toBe('/invite/abc_-1');
  });

  it('encodes the token as one path segment', () => {
    expect(invitePath('a/b?c')).toBe('/invite/a%2Fb%3Fc');
  });
});

describe('acceptedInvitePath (R-234)', () => {
  it('lands on Today with the coach, and the group when there is one', () => {
    expect(acceptedInvitePath('c1', null)).toBe('/?linked=c1');
    expect(acceptedInvitePath('c1', 'g1')).toBe('/?linked=c1&group=g1');
  });

  it('encodes the ids', () => {
    expect(acceptedInvitePath('a&b', 'c d')).toBe('/?linked=a%26b&group=c+d');
  });
});

describe('inviteTokenOf', () => {
  it('gives the token of an invite return path, else null', () => {
    const token = `${'A'.repeat(42)}_`;
    expect(inviteTokenOf(`/invite/${token}`)).toBe(token);
    expect(inviteTokenOf('/settings')).toBeNull();
    expect(inviteTokenOf(null)).toBeNull();
  });

  it('takes only a whole invite path, not one with more after the token', () => {
    expect(inviteTokenOf('/invite/abc/more')).toBeNull();
    expect(inviteTokenOf('/invite/abc?x=1')).toBeNull();
    expect(inviteTokenOf('/x/invite/abc')).toBeNull();
    expect(inviteTokenOf('/invite/')).toBeNull();
  });
});

// Where Settings goes back to is shell/nav-tabs' settingsBack (#400).
describe('settings from a tab', () => {
  it('carries the tab it is opened from', () => {
    expect(settingsPath('coach')).toBe('/settings?from=coach');
    expect(myCoachesPath('repertoires')).toBe(
      '/settings?from=repertoires#coaches',
    );
    // The same section ROUTES.myCoaches opens.
    expect(myCoachesPath('today')).toBe('/settings?from=today#coaches');
    expect(ROUTES.myCoaches).toBe('/settings#coaches');
  });
});

describe('coachPlayerPath', () => {
  it('is the coach dashboard player page for the id, encoded', () => {
    expect(coachPlayerPath('p1')).toBe('/coach/players/p1');
    expect(coachPlayerPath('a/b')).toBe('/coach/players/a%2Fb');
  });
});

describe('coachSharedRepertoirePath', () => {
  it('is the player page’s repertoire page for the ids, encoded', () => {
    expect(coachSharedRepertoirePath('p1', 'r1')).toBe(
      '/coach/players/p1/repertoires/r1',
    );
    expect(coachSharedRepertoirePath('a/b', 'c d')).toBe(
      '/coach/players/a%2Fb/repertoires/c%20d',
    );
  });
});

describe('coachProgressPath', () => {
  it('is the player page’s progress page for the ids, encoded', () => {
    expect(coachProgressPath('p1', 'r1')).toBe('/coach/players/p1/progress/r1');
    expect(coachProgressPath('a/b', 'c d')).toBe(
      '/coach/players/a%2Fb/progress/c%20d',
    );
  });
});

describe('coachGroupPath', () => {
  it('is the coach dashboard group page for the id, encoded', () => {
    expect(coachGroupPath('g1')).toBe('/coach/groups/g1');
    expect(coachGroupPath('a b')).toBe('/coach/groups/a%20b');
  });
});

describe('repertoireRoute', () => {
  it('is the repertoire list path followed by the id', () => {
    expect(repertoireRoute('3f1c')).toBe('/repertoires/3f1c');
    expect(repertoireRoute('a/b')).toBe('/repertoires/a%2Fb');
  });
});

describe('assignedRepertoirePath', () => {
  it('is the assigned repertoires path followed by the id, encoded', () => {
    expect(assignedRepertoirePath('3f1c')).toBe('/repertoires/assigned/3f1c');
    expect(assignedRepertoirePath('a/b')).toBe('/repertoires/assigned/a%2Fb');
  });
});

describe('repertoireChapterRoute', () => {
  it('opens the repertoire on one chapter, the id encoded as a query value', () => {
    expect(repertoireChapterRoute('3f1c', 'c3')).toBe(
      '/repertoires/3f1c?chapter=c3',
    );
    expect(repertoireChapterRoute('3f1c', 'a&b')).toBe(
      '/repertoires/3f1c?chapter=a%26b',
    );
  });
});

describe('repertoireExportRoute', () => {
  it('is the English API path for the PGN download', () => {
    expect(repertoireExportRoute('3f1c')).toBe('/api/repertoires/3f1c/export');
    expect(repertoireExportRoute('a/b')).toBe('/api/repertoires/a%2Fb/export');
  });
});

describe('importIntoRoute', () => {
  it('preselects the target repertoire on the import page', () => {
    expect(importIntoRoute('3f1c')).toBe('/repertoires/import?i=3f1c');
  });

  it('encodes the id as a query value', () => {
    expect(importIntoRoute('a&b c')).toBe('/repertoires/import?i=a%26b%20c');
  });
});

describe('repertoireDeletedRoute', () => {
  it('is the repertoire list, told a repertoire was deleted', () => {
    expect(repertoireDeletedRoute).toBe('/repertoires?deleted=1');
  });
});

describe('trainingPath', () => {
  it('is the training page in a mode, over every repertoire', () => {
    expect(ROUTES.training).toBe('/training');
    expect(trainingPath('review')).toBe('/training?mode=review');
    expect(trainingPath('learn')).toBe('/training?mode=learn');
  });

  it('scopes it to one repertoire, the id encoded as a query value', () => {
    expect(trainingPath('learn', 'a&b c')).toBe(
      '/training?mode=learn&r=a%26b%20c',
    );
  });
});

describe('learnPath (R-206)', () => {
  it('learns one chapter of a repertoire, the chapter id encoded', () => {
    expect(learnPath('r1', { chapterId: 'c 1' })).toBe(
      '/training?mode=learn&r=r1&chapter=c%201',
    );
  });

  it('learns one line of the chapter, the first line too', () => {
    expect(learnPath('r1', { chapterId: 'c1', lineIndex: 3 })).toBe(
      '/training?mode=learn&r=r1&chapter=c1&line=3',
    );
    expect(learnPath('r1', { chapterId: 'c1', lineIndex: 0 })).toBe(
      '/training?mode=learn&r=r1&chapter=c1&line=0',
    );
  });
});

describe('the Repertoire screens (R-226)', () => {
  it('sits under the repertoire it manages', () => {
    expect(repertoireManageRoute('r1')).toBe('/repertoires/r1/manage');
  });

  it('sits under the assigned repertoire, the id encoded', () => {
    expect(assignedManageRoute('r 1')).toBe(
      '/repertoires/assigned/r%201/manage',
    );
  });

  it('opens the assigned one on "make my own copy"', () => {
    expect(assignedForkRoute('r 1')).toBe(
      '/repertoires/assigned/r%201/manage?fork=1',
    );
  });
});

describe('trainingResultsRoute', () => {
  it('is the results endpoint', () => {
    expect(trainingResultsRoute).toBe('/api/training/results');
  });
});

// Each route that takes a query reads it beside its link builder (#402):
// what the builder writes, the reader reads back; anything else is absent.
describe('query readers (#402)', () => {
  /** A link's query as Next hands it to the page. */
  const queryOf = (link: string): Record<string, string> =>
    Object.fromEntries(new URL(link, 'http://x').searchParams);

  it('reads back who an accepted invite linked with, a single value each', () => {
    expect(readLinkedQuery(queryOf(acceptedInvitePath('c1', 'g1')))).toEqual({
      coachId: 'c1',
      groupId: 'g1',
    });
    expect(readLinkedQuery(queryOf(acceptedInvitePath('c1', null)))).toEqual({
      coachId: 'c1',
      groupId: undefined,
    });
    // A repeated param names no one (the address is not to be trusted).
    expect(readLinkedQuery({ linked: ['c1', 'c2'], group: ['g1'] })).toEqual({
      coachId: undefined,
      groupId: undefined,
    });
    expect(readLinkedQuery({})).toEqual({
      coachId: undefined,
      groupId: undefined,
    });
  });

  it('reads Settings’ tab and provider error, the first of a repeated one', () => {
    expect(readSettingsQuery(queryOf(settingsPath('coach')))).toEqual({
      from: 'coach',
      error: undefined,
    });
    expect(
      readSettingsQuery({ from: ['opponents', 'coach'], error: 'link_failed' }),
    ).toEqual({ from: 'opponents', error: 'link_failed' });
    expect(readSettingsQuery({})).toEqual({
      from: undefined,
      error: undefined,
    });
  });

  it('reads My repertoires’ deleted notice only from deleted=1', () => {
    expect(readRepertoiresQuery(queryOf(repertoireDeletedRoute))).toEqual({
      deleted: true,
    });
    expect(readRepertoiresQuery({ deleted: '0' })).toEqual({ deleted: false });
    expect(readRepertoiresQuery({ deleted: ['1'] })).toEqual({
      deleted: false,
    });
    expect(readRepertoiresQuery({})).toEqual({ deleted: false });
  });

  it('opens the fork question only from fork=1', () => {
    expect(readAssignedManageQuery(queryOf(assignedForkRoute('a1')))).toEqual({
      forkOpen: true,
    });
    expect(readAssignedManageQuery({ fork: 'yes' })).toEqual({
      forkOpen: false,
    });
    expect(readAssignedManageQuery({})).toEqual({ forkOpen: false });
  });

  it('reads the chapter a repertoire opens on, a well-formed id only', () => {
    expect(
      readRepertoireQuery(queryOf(repertoireChapterRoute('r1', 'c-2'))),
    ).toEqual({ chapterId: 'c-2' });
    expect(readRepertoireQuery({ chapter: '' })).toEqual({ chapterId: null });
    expect(readRepertoireQuery({ chapter: 'x'.repeat(21) })).toEqual({
      chapterId: null,
    });
    expect(readRepertoireQuery({ chapter: ['c-2'] })).toEqual({
      chapterId: null,
    });
    expect(readRepertoireQuery({})).toEqual({ chapterId: null });
  });

  describe('readTrainingQuery (R-142, R-206)', () => {
    const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
    const OTHER = '0b6c2a4e-1f3d-4e5a-8b7c-9d0e1f2a3b4c';

    it('reads back what trainingPath and learnPath write', () => {
      expect(readTrainingQuery(queryOf(trainingPath('learn', ID)))).toEqual({
        mode: 'learn',
        scope: { kind: 'repertoire', repertoireId: ID },
        focus: null,
      });
      expect(
        readTrainingQuery(
          queryOf(learnPath(ID, { chapterId: 'c1', lineIndex: 2 })),
        ).focus,
      ).toEqual({ repertoireId: ID, chapterId: 'c1', lineIndex: 2 });
    });

    it('is a review of every repertoire with nothing given', () => {
      expect(readTrainingQuery({})).toEqual({
        mode: 'review',
        scope: { kind: 'all' },
        focus: null,
      });
    });

    it('falls back to review for an unknown or repeated mode', () => {
      for (const mode of ['drill', '', ['learn', 'learn']])
        expect(readTrainingQuery({ mode }).mode).toBe('review');
    });

    it('drops a repertoire that is not one uuid', () => {
      for (const r of ['not-a-uuid', '', [ID, OTHER]])
        expect(readTrainingQuery({ mode: 'learn', r })).toEqual({
          mode: 'learn',
          scope: { kind: 'all' },
          focus: null,
        });
    });

    it('reads a chapter, and a line of it, to learn with r=', () => {
      expect(
        readTrainingQuery({ mode: 'learn', r: ID, chapter: 'c1', line: '0' })
          .focus,
      ).toEqual({ repertoireId: ID, chapterId: 'c1', lineIndex: 0 });
      expect(
        readTrainingQuery({ mode: 'learn', r: ID, chapter: 'c1' }).focus,
      ).toEqual({ repertoireId: ID, chapterId: 'c1' });
      expect(
        readTrainingQuery({ mode: 'learn', r: ID, chapter: 'c1' }).scope,
      ).toEqual({ kind: 'repertoire', repertoireId: ID });
    });

    it('drops the focus outside learn, without r=, or with a malformed chapter', () => {
      expect(
        readTrainingQuery({ mode: 'review', r: ID, chapter: 'c1' }).focus,
      ).toBeNull();
      expect(readTrainingQuery({ mode: 'learn', chapter: 'c1' }).focus).toBe(
        null,
      );
      for (const chapter of ['', 'x'.repeat(21), ['c1', 'c2']])
        expect(
          readTrainingQuery({ mode: 'learn', r: ID, chapter }).focus,
        ).toBeNull();
    });

    it('keeps the chapter but drops a malformed line', () => {
      for (const line of ['-1', '1.5', 'two', '', ['1', '2']])
        expect(
          readTrainingQuery({ mode: 'learn', r: ID, chapter: 'c1', line })
            .focus,
        ).toEqual({ repertoireId: ID, chapterId: 'c1' });
    });
  });

  it('reads the repertoire an import was opened from', () => {
    expect(readImportQuery(queryOf(importIntoRoute('r 1')))).toEqual({
      into: 'r 1',
    });
    expect(readImportQuery({ i: ['r1'] })).toEqual({ into: undefined });
    expect(readImportQuery({})).toEqual({ into: undefined });
  });
});
