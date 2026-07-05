import * as cheerio from 'cheerio';

export async function fetchFideName(
  fideId: string
): Promise<{ firstName: string; lastName: string } | null> {
  if (!fideId || !/^\d+$/.test(fideId.trim())) return null;
  try {
    const res = await fetch(`https://ratings.fide.com/profile/${fideId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) {
      console.error(`fetchFideName: non-OK response for id=${fideId} status=${res.status}`);
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $('h1.player-title').first().text().trim();
    if (!title) {
      console.error(
        `fetchFideName: no player-title found for id=${fideId} htmlLength=${html.length} snippet=${html.slice(0, 300).replace(/\s+/g, ' ')}`
      );
      return null;
    }

    // FIDE format: "Surname, Firstname"
    const commaIdx = title.indexOf(', ');
    if (commaIdx === -1) {
      console.error(`fetchFideName: unexpected title format for id=${fideId} title="${title}"`);
      return null;
    }

    const lastName = title.slice(0, commaIdx).trim();
    const firstName = title.slice(commaIdx + 2).trim();
    if (!lastName || !firstName) {
      console.error(`fetchFideName: empty name parts for id=${fideId} title="${title}"`);
      return null;
    }

    return { firstName, lastName };
  } catch (err) {
    console.error(`fetchFideName: exception for id=${fideId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
