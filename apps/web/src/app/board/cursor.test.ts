import { describe, expect, it } from 'vitest';
import { cursorStart, stepCursor } from './cursor';

describe('stepCursor', () => {
  it('moves as seen with White at the bottom', () => {
    expect(stepCursor('e4', 'ArrowUp', 'white')).toBe('e5');
    expect(stepCursor('e4', 'ArrowDown', 'white')).toBe('e3');
    expect(stepCursor('e4', 'ArrowLeft', 'white')).toBe('d4');
    expect(stepCursor('e4', 'ArrowRight', 'white')).toBe('f4');
  });

  it('moves as seen with Black at the bottom', () => {
    expect(stepCursor('e4', 'ArrowUp', 'black')).toBe('e3');
    expect(stepCursor('e4', 'ArrowDown', 'black')).toBe('e5');
    expect(stepCursor('e4', 'ArrowLeft', 'black')).toBe('f4');
    expect(stepCursor('e4', 'ArrowRight', 'black')).toBe('d4');
  });

  it('stays on the board at the edges', () => {
    expect(stepCursor('h8', 'ArrowUp', 'white')).toBe('h8');
    expect(stepCursor('h8', 'ArrowRight', 'white')).toBe('h8');
    expect(stepCursor('a1', 'ArrowDown', 'white')).toBe('a1');
    expect(stepCursor('a1', 'ArrowLeft', 'white')).toBe('a1');
    expect(stepCursor('a1', 'ArrowUp', 'black')).toBe('a1');
    expect(stepCursor('h8', 'ArrowLeft', 'black')).toBe('h8');
  });

  it('is null for a key that is not an arrow', () => {
    expect(stepCursor('e4', 'Tab', 'white')).toBeNull();
    expect(stepCursor('e4', 'Enter', 'black')).toBeNull();
  });
});

describe('cursorStart', () => {
  it('is the bottom-left square', () => {
    expect(cursorStart('white')).toBe('a1');
    expect(cursorStart('black')).toBe('h8');
  });
});
