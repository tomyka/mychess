import { usable } from './game-names';
import { splitGames } from './split-games';
import { tokenize } from './tokenize';

/**
 * The Event tag every game of `text` shares, ignoring PGN's "?" placeholder;
 * null when a game has none, they differ, or the text cannot be read.
 */
function sharedEvent(text: string): string | null {
  const tokens = tokenize(text);
  if (!tokens.ok) return null;
  const events = new Set(
    splitGames(tokens.value).map((game) => usable(game.headers['Event'])),
  );
  const [only = null] = events;
  return events.size === 1 ? only : null;
}

/** A file's name without its extension; '' for pasted text (no file). */
const baseName = (fileName: string | null): string =>
  fileName === null ? '' : fileName.replace(/\.[^.]*$/, '').trim();

/** `name` cut to `max` UTF-16 units, never leaving half a surrogate pair. */
const cut = (name: string, max: number): string =>
  name
    .slice(0, max)
    .replace(/[\uD800-\uDBFF]$/, '')
    .trimEnd();

/**
 * The name a new repertoire imported from `text` is suggested: the Event
 * tag every game shares, else the file's name without its extension, else
 * '' (pasted text); cut to `max`, the repertoire name's limit.
 */
export function suggestedRepertoireName(
  text: string,
  fileName: string | null,
  max: number,
): string {
  return cut(sharedEvent(text) ?? baseName(fileName), max);
}
