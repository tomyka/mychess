// @mychess/chess and @mychess/db for the E2E suite's own Node side.
// Playwright runs the suite as ES modules, and Node's ES module loader
// refuses @mychess/chess's JSON imports (its ECO tables, imported without
// `with { type: 'json' }`, as the bundlers that build the app allow).
// Loaded through CommonJS instead, Playwright's TypeScript hook compiles
// the packages and JSON needs no attribute. The type-only imports keep
// their types and load nothing.
import { createRequire } from 'node:module';
import type * as Chess from '@mychess/chess';
import type * as Db from '@mychess/db';

const load = createRequire(import.meta.url);

/** Does `loaded` export a function named each of `names`? */
const exportsAll = (loaded: unknown, names: readonly string[]): boolean =>
  typeof loaded === 'object' &&
  loaded !== null &&
  names.every((name) => typeof Reflect.get(loaded, name) === 'function');

const isChess = (loaded: unknown): loaded is typeof Chess =>
  exportsAll(loaded, ['importPgn', 'legalMoves', 'playerKeys', 'moveKey']);

const isDb = (loaded: unknown): loaded is typeof Db =>
  exportsAll(loaded, ['createDb']);

function required<T>(name: string, is: (loaded: unknown) => loaded is T): T {
  const loaded: unknown = load(name);
  if (!is(loaded)) throw new Error(`${name} did not load`);
  return loaded;
}

export const chess = required('@mychess/chess', isChess);
export const db = required('@mychess/db', isDb);
