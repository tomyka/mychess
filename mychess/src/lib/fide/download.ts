import { unzipSync } from 'fflate';

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
 * Downloads FIDE's monthly combined rating list (XML variant) and unzips it in
 * memory, returning the raw decompressed bytes.
 *
 * We return bytes (not a string) because the decompressed XML exceeds V8's
 * ~512 MB max string length; the caller decodes and parses it in chunks via
 * `parseFidePlayersFromBytes`.
 */
export async function downloadPlayersList(url: string = DEFAULT_URL): Promise<Uint8Array> {
  const res = await fetchWithRetry(url);

  const zipped = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(zipped);
  const names = Object.keys(files);
  const xmlName = names.find((n) => n.toLowerCase().endsWith('.xml')) ?? names[0];
  if (!xmlName) throw new Error('FIDE zip archive is empty');

  return files[xmlName];
}
