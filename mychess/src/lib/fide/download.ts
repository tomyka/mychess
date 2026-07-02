import { unzipSync, strFromU8 } from 'fflate';

const DEFAULT_URL = 'https://ratings.fide.com/download/players_list_xml.zip';

/**
 * Downloads FIDE's monthly combined rating list (XML variant), unzips it in
 * memory, and returns the XML file's contents as a string.
 */
export async function downloadPlayersList(url: string = DEFAULT_URL): Promise<string> {
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

  return strFromU8(files[xmlName]);
}
