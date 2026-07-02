import { describe, it, expect } from 'vitest';
import { parseFidePlayers } from './parse';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<playerslist>
<player>
<fideid>12865168</fideid>
<name>Konovalovas, Tomas</name>
<country>LTU</country>
<sex>M</sex>
<title></title>
<rating>0</rating>
<rapid_rating>1663</rapid_rating>
<blitz_rating>1530</blitz_rating>
<birthday>1978</birthday>
</player>
<player>
<fideid>1503014</fideid>
<name>Carlsen, Magnus</name>
<country>NOR</country>
<sex>M</sex>
<rating>2839</rating>
<rapid_rating>2828</rapid_rating>
<blitz_rating>2887</blitz_rating>
<birthday>1990</birthday>
</player>
<player>
<fideid>99999</fideid>
<name>Junior, Lietuvis</name>
<country>LTU</country>
<sex>F</sex>
<rating>1400</rating>
<birthday></birthday>
</player>
<player>
<fideid></fideid>
<name>No Id</name>
<country>LTU</country>
</player>
<player>
<fideid>12A45</fideid>
<name>Bad Id</name>
<country>LTU</country>
<rating>1500</rating>
</player>
</playerslist>`;

describe('parseFidePlayers', () => {
  it('extracts every player with a numeric fideid', () => {
    const players = parseFidePlayers(XML);
    expect(players.map(p => p.fideId)).toEqual(['12865168', '1503014', '99999']);
  });

  it('maps tags to typed fields', () => {
    const p = parseFidePlayers(XML)[0];
    expect(p).toEqual({
      fideId: '12865168',
      name: 'Konovalovas, Tomas',
      federation: 'LTU',
      sex: 'M',
      birthYear: 1978,
      stdRating: null,
      rapidRating: 1663,
      blitzRating: 1530,
    });
  });

  it('treats blank/missing numeric tags as null', () => {
    const junior = parseFidePlayers(XML)[2];
    expect(junior.birthYear).toBeNull();
    expect(junior.rapidRating).toBeNull();
    expect(junior.blitzRating).toBeNull();
    expect(junior.stdRating).toBe(1400);
  });

  it('skips players with a missing or non-numeric fideid', () => {
    const players = parseFidePlayers(XML);
    expect(players.find(p => p.name === 'No Id')).toBeUndefined();
    expect(players.find(p => p.name === 'Bad Id')).toBeUndefined();
  });

  it('returns an empty array for empty input', () => {
    expect(parseFidePlayers('')).toEqual([]);
  });
});
