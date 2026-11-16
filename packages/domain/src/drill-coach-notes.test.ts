import { moveKey, START_KEY } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { drillCoachNotes, type OwnCoachNote } from './drill-coach-notes';

const D4 = { from: START_KEY, san: 'd4', comment: '  Take the centre.  ' };
const KEY = moveKey(START_KEY, 'd4');
const ASSIGNED = { id: 'r1', kind: 'assigned', coachName: 'Jonas' } as const;
const OWN = { id: 'r1', kind: 'own' } as const;

const note = (
  extra: Partial<OwnCoachNote> & Pick<OwnCoachNote, 'source'>,
): OwnCoachNote => ({
  repertoireId: 'r1',
  moveKey: KEY,
  coachName: 'Ona',
  text: 'New.',
  ...extra,
});

describe('drillCoachNotes (#338)', () => {
  it('on an assigned repertoire is the move’s comment, trimmed, named with its coach (R-102)', () => {
    expect(drillCoachNotes(ASSIGNED, D4, [])).toEqual([
      { coachName: 'Jonas', text: 'Take the centre.' },
    ]);
  });

  it('on an assigned repertoire is none for no comment, or one of only whitespace', () => {
    expect(drillCoachNotes(ASSIGNED, { ...D4, comment: null }, [])).toEqual([]);
    expect(drillCoachNotes(ASSIGNED, { ...D4, comment: ' \n ' }, [])).toEqual(
      [],
    );
  });

  it('on an assigned repertoire never takes a note given for an own one', () => {
    expect(
      drillCoachNotes(ASSIGNED, { ...D4, comment: null }, [
        note({ source: 'shared' }),
      ]),
    ).toEqual([]);
  });

  it('on the player’s own repertoire is the fork’s kept note first, then the sharing coaches’, never its comment (R-107, R-43, R-141)', () => {
    const notes = [
      note({ source: 'shared', coachName: 'Ona', text: 'New.' }),
      note({ source: 'fork', coachName: 'Kept', text: 'Old.' }),
      note({ source: 'shared', coachName: 'Rūta', text: 'Also.' }),
    ];
    expect(drillCoachNotes(OWN, D4, notes)).toEqual([
      { coachName: 'Kept', text: 'Old.' },
      { coachName: 'Ona', text: 'New.' },
      { coachName: 'Rūta', text: 'Also.' },
    ]);
  });

  it('on the player’s own repertoire is only the notes of that repertoire and move', () => {
    const notes = [
      note({ source: 'shared', moveKey: 'other|e4', text: 'X' }),
      note({ source: 'fork', repertoireId: 'r2', text: 'Y' }),
    ];
    expect(drillCoachNotes(OWN, D4, notes)).toEqual([]);
  });
});
