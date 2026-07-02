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

export function parseFidePlayers(xml: string): FidePlayer[] {
  const players: FidePlayer[] = [];
  for (const m of xml.matchAll(/<player\b[^>]*>([\s\S]*?)<\/player>/g)) {
    const chunk = m[1];
    const fideId = tagValue(chunk, 'fideid');
    if (!fideId || !/^\d+$/.test(fideId)) continue;
    players.push({
      fideId,
      name: tagValue(chunk, 'name') ?? '',
      federation: tagValue(chunk, 'country') ?? '',
      sex: tagValue(chunk, 'sex'),
      birthYear: tagNumber(chunk, 'birthday'),
      stdRating: tagNumber(chunk, 'rating'),
      rapidRating: tagNumber(chunk, 'rapid_rating'),
      blitzRating: tagNumber(chunk, 'blitz_rating'),
    });
  }
  return players;
}
