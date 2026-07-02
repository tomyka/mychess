import { unzipSync } from 'fflate';

const DEFAULT_URL = 'https://ratings.fide.com/download/players_list_xml.zip';

/**
 * Downloads FIDE's monthly combined rating list (XML variant) and unzips it in
 * memory, returning the raw decompressed bytes.
 *
 * We return bytes (not a string) because the decompressed XML exceeds V8's
 * ~512 MB max string length; the caller decodes and parses it in chunks via
 * `parseFidePlayersFromBytes`.
 */
export async function downloadPlayersList(url: string = DEFAULT_URL): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`FIDE download failed: ${res.status} ${res.statusText}`);

  const zipped = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(zipped);
  const names = Object.keys(files);
  const xmlName = names.find((n) => n.toLowerCase().endsWith('.xml')) ?? names[0];
  if (!xmlName) throw new Error('FIDE zip archive is empty');

  return files[xmlName];
}
