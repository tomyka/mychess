import { moveKey, START_KEY } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf } from '../../../test/fixtures/repertoires';
import type { TrainingData } from '../../lib/training-data';
import { coachNotesFor } from './coach-note';

const D4 = moveKey(START_KEY, 'd4');

/** One repertoire of `kind` holding `pgn`, and its first move. */
function oneMove(
  pgn: string,
  entry: { kind: 'own' } | { kind: 'assigned'; coachName: string },
  coachNotes: TrainingData['coachNotes'] = [],
) {
  const graph = graphOf(pgn);
  const data: Pick<TrainingData, 'entries' | 'coachNotes'> = {
    entries: [
      {
        id: 'r1',
        name: 'R',
        side: 'white',
        active: true,
        graph,
        chapterTitles: {},
        ...entry,
      },
    ],
    coachNotes,
  };
  return { data, move: graph.moves[0] };
}

const ASSIGNED = { kind: 'assigned', coachName: 'Ona' } as const;
const OWN = { kind: 'own' } as const;

// The rule is the domain's (drillCoachNotes); this checks what it is given.
describe('the coach notes on a move in training', () => {
  it('are an assigned repertoire’s comment, named with its coach (R-102)', () => {
    const { data, move } = oneMove('1. d4 { Take the centre. } *', ASSIGNED);
    expect(coachNotesFor(data, 'r1', move)).toEqual([
      { coachName: 'Ona', text: 'Take the centre.' },
    ]);
  });

  it('are the coaches’ notes on the player’s own repertoire, never its comment (R-107, R-43)', () => {
    const { data, move } = oneMove('1. d4 { Mine. } *', OWN, [
      {
        repertoireId: 'r1',
        moveKey: D4,
        coachName: 'Jonas',
        text: 'Shared.',
        source: 'shared',
      },
      {
        repertoireId: 'r1',
        moveKey: D4,
        coachName: 'Kept',
        text: 'Old.',
        source: 'fork',
      },
    ]);
    expect(coachNotesFor(data, 'r1', move)).toEqual([
      { coachName: 'Kept', text: 'Old.' },
      { coachName: 'Jonas', text: 'Shared.' },
    ]);
  });

  it('are none for another repertoire or no move', () => {
    const { data, move } = oneMove('1. d4 { Take the centre. } *', ASSIGNED);
    expect(coachNotesFor(data, 'r2', move)).toEqual([]);
    expect(coachNotesFor(data, 'r1', undefined)).toEqual([]);
  });
});
