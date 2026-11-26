import { describe, expect, it } from 'vitest';
import { suggestedRepertoireName } from './suggested-name';

const MAX = 80;

const game = (event: string | null, moves = '1. e4 c5 *') =>
  `${event === null ? '[White "X"]' : `[Event "${event}"]`}\n\n${moves}\n`;

const suggest = (text: string, fileName: string | null = 'taimanov.pgn') =>
  suggestedRepertoireName(text, fileName, MAX);

describe('suggestedRepertoireName', () => {
  it('takes the Event every game shares, trimmed', () => {
    expect(suggest(game(' Taimanov prep ') + game('Taimanov prep'))).toBe(
      'Taimanov prep',
    );
    expect(suggest(game('Taimanov prep'), null)).toBe('Taimanov prep');
  });

  it('reads an escaped quote in the Event', () => {
    expect(suggest(game('The \\"Hedgehog\\"'))).toBe('The "Hedgehog"');
  });

  it('takes the file name without its extension when the Events differ', () => {
    expect(suggest(game('Taimanov prep') + game('Najdorf'))).toBe('taimanov');
    expect(suggest(game('A') + game('B'), 'my.prep.pgn')).toBe('my.prep');
  });

  it('takes the file name when a game has no Event', () => {
    expect(suggest(game('Taimanov prep') + game(null))).toBe('taimanov');
    // Movetext with no headers after a headered game is a game of its own.
    expect(suggest(`${game('Taimanov prep')}1. d4 d5 *\n`)).toBe('taimanov');
  });

  it('counts the "?" placeholder and a blank Event as none', () => {
    expect(suggest(game('?') + game('?'))).toBe('taimanov');
    expect(suggest(game('') + game(' '))).toBe('taimanov');
    expect(suggest(game('?'), null)).toBe('');
  });

  it('suggests nothing for pasted text without an Event, or unreadable', () => {
    expect(suggest('1. e4 c5 *', null)).toBe('');
    expect(suggest('[Event "unclosed', null)).toBe('');
    expect(suggest('[Event "unclosed', 'broken.pgn')).toBe('broken');
  });

  it('keeps a file name with no extension whole', () => {
    expect(suggest('1. e4 c5 *', 'taimanov')).toBe('taimanov');
  });

  it('cuts a name longer than the maximum to it', () => {
    const long = 'Sicilian '.repeat(12);
    const cut = suggest(game(long));
    expect(cut).toBe(long.slice(0, MAX).trimEnd());
    expect(cut.length).toBeLessThanOrEqual(MAX);
    expect(suggest('1. e4 *', `${'a'.repeat(100)}.pgn`)).toBe('a'.repeat(MAX));
  });

  it('never cuts a letter outside the basic plane in half', () => {
    const name = `${'a'.repeat(MAX - 1)}\u{1F600}`;
    expect(suggest(game(name))).toBe('a'.repeat(MAX - 1));
  });
});
