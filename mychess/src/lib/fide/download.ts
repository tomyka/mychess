import { Unzip, UnzipInflate } from 'fflate';

const DEFAULT_URL = 'https://ratings.fide.com/download/players_list_xml.zip';

// FIDE's own server is occasionally slow enough to trip Node/undici's
// internal ~10s TCP connect timeout well before the 120s overall
// AbortSignal below ever gets a chance to matter. This import only runs
// once a month (see .github/workflows/fide-import.yml) with nobody
// watching in real time — a single transient connect timeout or 5xx used
// to sink the *entire month's* import silently, and the FIDE data on the
// dashboard just sat stale for weeks until a player happened to notice
// (mychess.lt, Aug 2026 — the scheduled Aug 1 run failed with exactly this
// connect-timeout error, and it went unnoticed until Aug 17). A few
// retries with backoff absorbs a single blip without masking a genuinely
// broken URL or a real, persistent outage.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 10_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) return res;
      lastError = new Error(`FIDE download failed: ${res.status} ${res.statusText}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_ATTEMPTS) await delay(RETRY_DELAY_MS * attempt);
  }
  throw lastError;
}

/**
 * Downloads FIDE's monthly combined rating list (XML variant), decompresses
 * it, and hands the decompressed XML to `onChunk` as bytes become available —
 * end-to-end streaming, never materializing the full compressed (~47 MB) or
 * decompressed (~800+ MB as of Aug 2026, and only growing every month) file
 * in memory at once. `onChunk`'s `final` flag marks the last call.
 *
 * This used to buffer the whole response via `res.arrayBuffer()` then
 * `unzipSync` it in one shot, returning the fully-materialized decompressed
 * bytes. That worked fine on a GitHub Actions runner (~7 GB RAM), but this
 * import now runs inside a Vercel serverless function instead (see
 * .github/workflows/fide-import.yml's own comment for why) — confirmed via
 * Vercel runtime logs that even at the platform's max per-function memory,
 * the whole-buffer approach got OOM-killed once FIDE's real decompressed
 * size (~800 MB, confirmed by downloading and unzipping the file directly —
 * nowhere near the ~200 MB this code used to assume) is accounted for.
 * Streaming end-to-end keeps peak memory to a small rolling buffer
 * regardless of how large the underlying file is or ever grows to.
 */
export async function streamPlayersList(
  onChunk: (chunk: Uint8Array, final: boolean) => void,
  url: string = DEFAULT_URL
): Promise<void> {
  const res = await fetchWithRetry(url);
  if (!res.body) throw new Error('FIDE download response has no body to stream');

  let sawFile = false;
  let pendingError: unknown;

  const unzipper = new Unzip((file) => {
    sawFile = true;
    file.ondata = (err, chunk, final) => {
      if (err) {
        pendingError = err;
        return;
      }
      onChunk(chunk, final);
    };
    file.start();
  });
  // Synchronous inflate decoder — runs on this same thread rather than a
  // worker (fflate's AsyncUnzipInflate), trading a bit of CPU-bound latency
  // for not needing worker_threads to bundle/spawn cleanly inside a
  // SvelteKit/Vercel serverless function. Streaming is what actually fixes
  // the memory problem here; running inflate off-thread is an orthogonal
  // concern this import doesn't need.
  unzipper.register(UnzipInflate);

  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (pendingError) throw pendingError;
    if (done) {
      unzipper.push(new Uint8Array(0), true);
      break;
    }
    unzipper.push(value, false);
    if (pendingError) throw pendingError;
  }

  if (!sawFile) throw new Error('FIDE zip archive is empty');
}
