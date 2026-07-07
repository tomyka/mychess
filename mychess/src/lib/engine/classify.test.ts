// mychess/src/lib/engine/classify.test.ts
import { describe, it, expect } from 'vitest';
import { toPlayerPerspective, classifySwing, evaluateSwing } from './classify';

describe('toPlayerPerspective', () => {
  it('negates a centipawn score, since the opponent is always to move after the players own move', () => {
    expect(toPlayerPerspective({ cp: 120, mate: null })).toBe(-120);
    expect(toPlayerPerspective({ cp: -80, mate: null })).toBe(80);
  });

  it('treats a positive mate score (opponent mates) as very bad for the player', () => {
    expect(toPlayerPerspective({ cp: null, mate: 3 })).toBeLessThan(-99000);
  });

  it('treats a negative mate score (opponent gets mated) as very good for the player', () => {
    expect(toPlayerPerspective({ cp: null, mate: -3 })).toBeGreaterThan(99000);
  });

  it('a closer mate against the player counts for more than a farther one', () => {
    const mateIn1 = toPlayerPerspective({ cp: null, mate: 1 });
    const mateIn5 = toPlayerPerspective({ cp: null, mate: 5 });
    expect(mateIn1).toBeLessThan(mateIn5);
  });

  it('treats a missing cp score as 0', () => {
    expect(toPlayerPerspective({ cp: null, mate: null })).toBe(0);
  });
});

describe('classifySwing', () => {
  it('classifies at the fine/inaccuracy boundary (<=50 fine, >50 inaccuracy)', () => {
    expect(classifySwing(50)).toBe('fine');
    expect(classifySwing(51)).toBe('inaccuracy');
  });

  it('classifies at the inaccuracy/mistake boundary (<=100 inaccuracy, >100 mistake)', () => {
    expect(classifySwing(100)).toBe('inaccuracy');
    expect(classifySwing(101)).toBe('mistake');
  });

  it('classifies at the mistake/blunder boundary (<=300 mistake, >300 blunder)', () => {
    expect(classifySwing(300)).toBe('mistake');
    expect(classifySwing(301)).toBe('blunder');
  });

  it('classifies a negative or zero swing as fine (played move was at least as good)', () => {
    expect(classifySwing(0)).toBe('fine');
    expect(classifySwing(-40)).toBe('fine');
  });
});

describe('evaluateSwing', () => {
  it('computes the swing as book eval minus played eval, from the players perspective', () => {
    // book: toPlayerPerspective({cp:-50}) = 50. played: toPlayerPerspective({cp:250}) = -250.
    // swing = 50 - (-250) = 300 -> mistake (<=300)
    const result = evaluateSwing({ cp: -50, mate: null }, { cp: 250, mate: null });
    expect(result.swingCp).toBe(300);
    expect(result.quality).toBe('mistake');
  });

  it('a played move at least as good as the book move classifies as fine', () => {
    // book: toPlayerPerspective({cp:0}) = 0. played: toPlayerPerspective({cp:-10}) = 10.
    // swing = 0 - 10 = -10 -> fine
    const result = evaluateSwing({ cp: 0, mate: null }, { cp: -10, mate: null });
    expect(result.swingCp).toBe(-10);
    expect(result.quality).toBe('fine');
  });
});
