import * as cheerio from 'cheerio';

export async function fetchFideName(
  fideId: string
): Promise<{ firstName: string; lastName: string } | null> {
  if (!fideId || fideId.trim().length < 3) return null;
  try {
    const res = await fetch(`https://ratings.fide.com/profile/${fideId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $('h1.player-title').first().text().trim();
    if (!title) return null;

    // FIDE format: "Surname, Firstname"
    const commaIdx = title.indexOf(', ');
    if (commaIdx === -1) return null;

    const lastName = title.slice(0, commaIdx).trim();
    const firstName = title.slice(commaIdx + 2).trim();
    if (!lastName || !firstName) return null;

    return { firstName, lastName };
  } catch {
    return null;
  }
}
