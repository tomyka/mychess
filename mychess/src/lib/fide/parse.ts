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

// One compiled RegExp per tag, built once at module load rather than per
// call — the full FIDE list has on the order of a million players, and
// parsePlayerElement looks up 8 tags on *every one* of them (LTU-filtered
// or not, since `keep` only decides what's retained afterward), so a
// naive `new RegExp(...)` per lookup was ~8 million throwaway RegExp +
// match-array allocations per import run. A plain (non-`/g`) RegExp has no
// `lastIndex` state, so reusing the same compiled instance across calls is
// safe.
const TAG_PATTERNS = {
  fideid: /<fideid>([^<]*)<\/fideid>/,
  name: /<name>([^<]*)<\/name>/,
  country: /<country>([^<]*)<\/country>/,
  sex: /<sex>([^<]*)<\/sex>/,
  birthday: /<birthday>([^<]*)<\/birthday>/,
  rating: /<rating>([^<]*)<\/rating>/,
  rapid_rating: /<rapid_rating>([^<]*)<\/rapid_rating>/,
  blitz_rating: /<blitz_rating>([^<]*)<\/blitz_rating>/,
} as const;

type Tag = keyof typeof TAG_PATTERNS;

function tagValue(chunk: string, tag: Tag): string | null {
  const m = chunk.match(TAG_PATTERNS[tag]);
  const v = m ? m[1].trim() : '';
  return v || null;
}

function tagNumber(chunk: string, tag: Tag): number | null {
  const v = tagValue(chunk, tag);
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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

export interface FideStreamParser {
  /** Feed the next chunk of decompressed XML bytes, in order. */
  push(chunk: Uint8Array): void;
  /** Flushes any trailing partial content and returns every kept player. */
  finish(): FidePlayer[];
}

const PLAYER_OPEN = '<player';
const PLAYER_CLOSE = '</player>';
const GT = '>'.charCodeAt(0);

/** Zero-copy view of `u8`'s bytes as a Node `Buffer`, for its native (C++-backed) `indexOf`/`toString`. */
function toBuffer(u8: Uint8Array): Buffer {
  return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}

/**
 * A push-based counterpart to `parseFidePlayersFromBytes` for when the
 * decompressed XML arrives incrementally (e.g. streamed straight out of a
 * zip decoder) rather than as one fully-materialized buffer — see
 * `streamPlayersList` in `./download`, which feeds this directly so the
 * ~800+ MB (and growing every month) decompressed FIDE list is never held
 * in memory all at once.
 *
 * The rolling buffer here is a Node `Buffer`, not a JS string — confirmed
 * live (Aug 2026) that decoding the whole stream into one growing JS
 * string via repeated `+=`, finding `<player>` blocks with a regex, then
 * `.slice()`-ing off the consumed prefix, leaked: V8's ConsString/
 * SlicedString representation for a string built that way keeps retaining
 * old backing storage, so heap usage grew linearly with total bytes
 * processed instead of staying bounded — reproduced against the real
 * ~800 MB FIDE file, which OOM'd a 1.5 GB heap well before finishing. A
 * first fix (hand-rolled byte-array boundary search, no string at all
 * until a single player's own span is isolated) fixed the leak but was far
 * too slow for ~1.7 million players' worth of byte-by-byte JS comparisons
 * to finish inside a serverless function's time limit. `Buffer`'s
 * `indexOf`/`concat`/`toString` are native (V8/Node C++), not JS loops —
 * fast *and* bounded, since `Buffer.concat` always produces one fresh,
 * appropriately-sized allocation rather than a view chain that keeps
 * retaining old, larger backing buffers the way string slicing did.
 */
export function createFideStreamParser(keep: (p: FidePlayer) => boolean = () => true): FideStreamParser {
  const players: FidePlayer[] = [];
  let pending: Buffer = Buffer.alloc(0);

  const drain = () => {
    for (;;) {
      const openIdx = pending.indexOf(PLAYER_OPEN);
      if (openIdx === -1) {
        // No opening tag at all yet — keep only enough of the tail that a
        // `<player` split across the next chunk boundary can still be found.
        const keepFrom = Math.max(0, pending.length - (PLAYER_OPEN.length - 1));
        if (keepFrom > 0) pending = pending.subarray(keepFrom);
        return;
      }
      const tagEnd = pending.indexOf(GT, openIdx + PLAYER_OPEN.length);
      if (tagEnd === -1) {
        // The opening tag itself isn't fully buffered yet. Drop anything
        // before it (uninteresting prologue/whitespace) and wait for more.
        if (openIdx > 0) pending = pending.subarray(openIdx);
        return;
      }
      const closeIdx = pending.indexOf(PLAYER_CLOSE, tagEnd);
      if (closeIdx === -1) {
        // Whole element isn't fully buffered yet — same idea, wait for more.
        if (openIdx > 0) pending = pending.subarray(openIdx);
        return;
      }
      const inner = pending.toString('utf-8', tagEnd + 1, closeIdx);
      const p = parsePlayerElement(inner);
      if (p && keep(p)) players.push(p);
      pending = pending.subarray(closeIdx + PLAYER_CLOSE.length);
    }
  };

  return {
    push(chunk: Uint8Array) {
      // `pending` outlives this call — whatever `drain` couldn't consume (a
      // player record straddling the chunk boundary) is carried into the next
      // push. So it has to own its bytes: fflate hands out views into its own
      // internal output buffer and is free to reuse that buffer on a later
      // push, which would silently rewrite a half-parsed record underneath us.
      // The `Buffer.concat` branch already allocates a fresh buffer; only the
      // empty-`pending` branch used to keep a zero-copy view, so `Buffer.from`
      // (which copies) is the whole fix. Cost is negligible on a real run:
      // that branch is reached on the first push plus only the rare chunk that
      // happens to end exactly on a `</player>` boundary, it's one native
      // memcpy of a single chunk (not the file), and it adds no per-record
      // allocation.
      pending =
        pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, toBuffer(chunk)]);
      drain();
    },
    finish(): FidePlayer[] {
      drain();
      return players;
    }
  };
}

/**
 * Whole-buffer variant of `createFideStreamParser`, for callers that already
 * have the full decompressed XML as one `Uint8Array` (e.g. tests, or a list
 * small enough not to need true streaming). Chunks it internally at
 * `chunkSize` purely to bound the decoder's own rolling buffer — this still
 * requires `bytes` to already be fully materialized, unlike the stream
 * parser above.
 */
export function parseFidePlayersFromBytes(
  bytes: Uint8Array,
  keep: (p: FidePlayer) => boolean = () => true,
  chunkSize = 1 << 22 // 4 MB
): FidePlayer[] {
  const parser = createFideStreamParser(keep);
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parser.push(bytes.subarray(i, i + chunkSize));
  }
  return parser.finish();
}
