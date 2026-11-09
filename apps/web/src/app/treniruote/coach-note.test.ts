import { describe, expect, it } from 'vitest';
import { graphOf } from '../../../test/fixtures/repertoires';
import type { TrainingData } from '../../lib/training-data';
import { coachNoteOn } from './coach-note';

/** One repertoire of `kind` holding `pgn`, and its first move. */
function oneMove(pgn: string, kind: 'assigned' | 'own' = 'assigned') {
  const graph = graphOf(pgn);
  const entries: TrainingData['entries'] = [
    { id: 'r1', name: 'R', side: 'white', kind, active: true, graph },
  ];
  return { entries, move: graph.moves[0] };
}

describe('the coach note on a move in training', () => {
  it('is the comment on a move of an assigned repertoire, trimmed', () => {
    const { entries, move } = oneMove('1. d4 {  Take the centre.  } *');
    expect(coachNoteOn(entries, 'r1', move)).toBe('Take the centre.');
  });

  it('is none for a comment of only whitespace', () => {
    const { entries, move } = oneMove('1. d4 *');
    const blank = move === undefined ? undefined : { ...move, comment: ' \n ' };
    expect(coachNoteOn(entries, 'r1', blank)).toBeNull();
  });

  it('is none on the player’s own repertoire, another repertoire or no move', () => {
    const own = oneMove('1. d4 { Mine. } *', 'own');
    expect(coachNoteOn(own.entries, 'r1', own.move)).toBeNull();
    const { entries, move } = oneMove('1. d4 { Take the centre. } *');
    expect(coachNoteOn(entries, 'r2', move)).toBeNull();
    expect(coachNoteOn(entries, 'r1', undefined)).toBeNull();
  });
});
