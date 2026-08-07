export interface FidePlayer {
  fideId: string;
  name: string;
  federation: string;
  sex: string | null;
  birthYear: number | null;
  stdRating: number | null;
  rapidRating: number | null;
  blitzRating: number | null;
}

function tagValue(chunk: string, tag: string): string | null {
  // `tag` is always one of this file's own hardcoded literal call-site
  // strings ('fideid', 'name', 'country', ...) — never derived from `chunk`
  // (the untrusted parsed content) — so there's no injection/ReDoS surface
  // despite the non-literal constructor call.
  // eslint-disable-next-line security/detect-non-literal-regexp
  const m = chunk.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  const v = m ? m[1].trim() : '';
  return v || null;
}

function tagNumber(chunk: string, tag: string): number | null {
  const v = tagValue(chunk, tag);
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const PLAYER_RE = /<player\b[^>]*>([\s\S]*?)<\/player>/g;

/** Parses the inner content of one <player>…</player>. Returns null if the id is missing/non-numeric. */
function parsePlayerElement(inner: string): FidePlayer | null {
  const fideId = tagValue(inner, 'fideid');
  if (!fideId || !/^\d+$/.test(fideId)) return null;
  return {
    fideId,
    name: tagValue(inner, 'name') ?? '',
    federation: tagValue(inner, 'country') ?? '',
    sex: tagValue(inner, 'sex'),
    birthYear: tagNumber(inner, 'birthday'),
    stdRating: tagNumber(inner, 'rating'),
    rapidRating: tagNumber(inner, 'rapid_rating'),
    blitzRating: tagNumber(inner, 'blitz_rating'),
  };
}

/**
 * Streaming variant for the full FIDE list, whose decompressed XML exceeds V8's
 * ~512 MB max string length. Decodes the bytes in chunks, extracts complete
 * <player> blocks from a small rolling buffer, and keeps only players for which
 * `keep` returns true (called once per valid-id player — use it to count totals
 * and filter to a federation without accumulating the whole list).
 */
export function parseFidePlayersFromBytes(
  bytes: Uint8Array,
  keep: (p: FidePlayer) => boolean = () => true,
  chunkSize = 1 << 22 // 4 MB
): FidePlayer[] {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const players: FidePlayer[] = [];
  let buffer = '';

  const drain = () => {
    PLAYER_RE.lastIndex = 0;
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = PLAYER_RE.exec(buffer)) !== null) {
      const p = parsePlayerElement(m[1]);
      if (p && keep(p)) players.push(p);
      lastEnd = PLAYER_RE.lastIndex;
    }
    // Drop everything through the last complete </player>; keep any partial tail.
    if (lastEnd > 0) buffer = buffer.slice(lastEnd);
  };

  for (let i = 0; i < bytes.length; i += chunkSize) {
    buffer += decoder.decode(bytes.subarray(i, i + chunkSize), { stream: true });
    drain();
  }
  buffer += decoder.decode(); // flush any trailing bytes
  drain();

  return players;
}
