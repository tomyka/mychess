/**
 * A persona repertoire as its persona imported it: from their own PGN file
 * (with comments and NAGs) where the doc says so, read from the one
 * committed copy in packages/chess/src/pgn/fixtures (#335), else from the
 * doc's bare lines. The file is found through @mychess/chess's
 * `./fixtures/*` export, so the path holds both from source (tests) and
 * from the seed:personas bundle in local/dist.
 */
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import {
  importChapters,
  importChaptersFromPgn,
  type ImportedChapters,
  type PersonaPgnFile,
  type PersonaRepertoire,
} from './lines';

/** The text of persona PGN file `file`. */
export function readPersonaPgn(file: PersonaPgnFile): string {
  const { resolve } = nodeModule.createRequire(import.meta.url);
  return readFileSync(resolve(`@mychess/chess/fixtures/${file}`), 'utf8');
}

/** What the app's PGN import makes of `r`, as its persona imported it. */
export function importPersonaRepertoire(
  r: PersonaRepertoire,
): ImportedChapters {
  return r.pgnFile === undefined
    ? importChapters(r.side, r.chapters)
    : importChaptersFromPgn(r.side, r.chapters, readPersonaPgn(r.pgnFile));
}
