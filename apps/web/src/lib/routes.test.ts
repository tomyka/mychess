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
