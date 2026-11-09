/**
 * The persona repertoires: the ```pgn fences of docs/personas/*.md, line
 * for line, each label a chapter (2000plus.md's in repertoires-2000plus.ts).
 * Keep them in step with the docs (and with
 * packages/chess/src/personas.test.ts, which checks the same lines).
 * Pure data.
 */
import { chapter, type PersonaRepertoire } from './lines';
import {
  CATALAN,
  CATALAN_A4,
  NAJDORF,
  NAJDORF_E6,
  NAJDORF_NG4,
  NIMZO,
} from './repertoires-2000plus';

/** docs/personas/u1400.md, "Itališkoji partija". */
const ITALIAN: PersonaRepertoire = {
  handle: 'italian',
  owner: 'coach',
  side: 'white',
  name: 'Itališkoji partija',
  chapters: [
    chapter(
      'Giuoco Pianissimo',
      '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O 7. Re1 a6 8. Bb3 Ba7',
    ),
    chapter(
      'Two Knights, transposes',
      '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 Bc5 5. c3 d6 6. O-O O-O 7. Re1 a6 8. Bb3 Ba7',
    ),
    chapter(
      'Two Knights, 4...Be7',
      '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 Be7 5. O-O O-O 6. Re1 d6 7. c3 Na5 8. Bb5 a6 9. Ba4 b5 10. Bc2',
    ),
    chapter(
      'Petrov',
      '1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 4. Nf3 Nxe4 5. d4 d5 6. Bd3 Nc6 7. O-O Be7 8. c4',
    ),
    chapter(
      'vs Sicilian, Bb5+',
      '1. e4 c5 2. Nf3 d6 3. Bb5+ Bd7 4. Bxd7+ Qxd7 5. O-O Nc6 6. c3 Nf6 7. Re1 e6 8. d4 cxd4 9. cxd4',
    ),
    chapter(
      'vs French, Exchange',
      '1. e4 e6 2. d4 d5 3. exd5 exd5 4. Nf3 Nf6 5. Bd3 Bd6 6. O-O O-O 7. Bg5 Bg4 8. Nbd2 Nbd7',
    ),
    chapter(
      'vs Caro-Kann, Advance',
      '1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nf3 e6 5. Be2 c5 6. Be3 Qb6 7. Nc3 Nc6 8. Na4 Qa5+ 9. c3 c4',
    ),
    chapter(
      'vs Scandinavian',
      '1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5 4. d4 Nf6 5. Nf3 Bf5 6. Bc4 e6 7. Bd2 c6 8. Qe2',
    ),
  ],
};

/** docs/personas/u1400.md, "Londono sistema" (Rokas's own, private). */
const LONDON: PersonaRepertoire = {
  handle: 'london',
  owner: 'u1400',
  side: 'white',
  name: 'Londono sistema',
  chapters: [
    chapter(
      'London vs ...d5',
      '1. d4 d5 2. Bf4 Nf6 3. e3 e6 4. Nf3 c5 5. c3 Nc6 6. Nbd2 Bd6 7. Bg3 O-O 8. Bd3',
    ),
    chapter(
      "London vs King's Indian setup",
      '1. d4 Nf6 2. Bf4 g6 3. e3 Bg7 4. Nf3 O-O 5. Be2 d6 6. h3 c5 7. c3 Nc6 8. O-O',
    ),
  ],
};

/** docs/personas/u1400.md, "1...e5". */
const OPEN_GAMES: PersonaRepertoire = {
  handle: 'open-games',
  owner: 'coach',
  side: 'black',
  name: '1...e5',
  chapters: [
    chapter(
      'Italian',
      '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O 7. Re1 a6 8. Bb3 Ba7',
    ),
    chapter(
      'Ruy Lopez',
      '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O',
    ),
    chapter(
      'Scotch',
      '1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nxc6 bxc6 6. Bd3 d5 7. exd5 cxd5 8. O-O Be7',
    ),
    chapter(
      'Four Knights',
      '1. e4 e5 2. Nc3 Nf6 3. Nf3 Nc6 4. Bb5 Bb4 5. O-O O-O 6. d3 d6 7. Bg5 Bxc3 8. bxc3 Qe7',
    ),
  ],
};

/** docs/personas/u1400.md, "Atmestas valdovės gambitas". */
const QGD: PersonaRepertoire = {
  handle: 'qgd',
  owner: 'coach',
  side: 'black',
  name: 'Atmestas valdovės gambitas',
  chapters: [
    chapter(
      'QGD Orthodox',
      '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 Nbd7 7. Rc1 c6 8. Bd3 dxc4 9. Bxc4 Nd5',
    ),
    chapter(
      'vs London',
      '1. d4 d5 2. Bf4 Nf6 3. e3 c5 4. c3 Nc6 5. Nd2 e6 6. Ngf3 Bd6 7. Bg3 O-O 8. Bd3',
    ),
  ],
};

/** docs/personas/1400-2000.md, "Valdovės gambitas". */
const QUEENS_GAMBIT: PersonaRepertoire = {
  handle: 'queens-gambit',
  owner: 'coach',
  side: 'white',
  name: 'Valdovės gambitas',
  chapters: [
    chapter(
      'QGD Exchange, Carlsbad',
      '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5 exd5 5. Bg5 Be7 6. e3 O-O 7. Bd3 Nbd7 8. Qc2 Re8 9. Nge2 Nf8 10. O-O c6 11. f3 Ne6 12. Bh4',
    ),
    chapter(
      'Slav, 4...dxc4 5.a4',
      '1. d4 d5 2. c4 c6 3. Nf3 Nf6 4. Nc3 dxc4 5. a4 Bf5 6. e3 e6 7. Bxc4 Bb4 8. O-O Nbd7 9. Qe2 Bg6 10. e4 O-O 11. Bd3 Bh5 12. Bf4',
    ),
    chapter(
      'QGA, 3.e4',
      '1. d4 d5 2. c4 dxc4 3. e4 e5 4. Nf3 exd4 5. Bxc4 Nc6 6. O-O Be6 7. Bxe6 fxe6 8. Qb3 Qd7 9. Qxb7 Rb8 10. Qa6 Nf6 11. Nbd2 Bd6 12. Nc4',
    ),
    chapter(
      'Albin Countergambit',
      '1. d4 d5 2. c4 e5 3. dxe5 d4 4. Nf3 Nc6 5. g3 Be6 6. Nbd2 Qd7 7. Bg2 O-O-O 8. O-O Bh3 9. Bxh3 Qxh3 10. a3 Nge7 11. b4 Ng6 12. Qa4',
    ),
    chapter(
      'Nimzo-Indian, Rubinstein',
      '1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. e3 O-O 5. Bd3 d5 6. Nf3 c5 7. O-O Nc6 8. a3 Bxc3 9. bxc3 dxc4 10. Bxc4 Qc7 11. Bd3 e5 12. Qc2',
    ),
    chapter(
      "King's Indian, Classical",
      '1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O 6. Be2 e5 7. O-O Nc6 8. d5 Ne7 9. Ne1 Nd7 10. Nd3 f5 11. Bd2 Nf6 12. f3',
    ),
  ],
};

/** docs/personas/1400-2000.md, the Taimanov (Gabija's own, shared with the coach). */
const TAIMANOV: PersonaRepertoire = {
  handle: 'taimanov',
  owner: '1400-2000',
  side: 'black',
  name: 'Sicilijos gynyba, Taimanovo variantas',
  chapters: [
    chapter(
      'English Attack',
      '1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 Qc7 6. Be3 a6 7. Qd2 Nf6 8. O-O-O Bb4 9. f3 Ne5 10. Nb3 b5 11. Qe1 Be7 12. f4 Nc4',
    ),
    chapter(
      '6.Be2',
      '1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 Qc7 6. Be2 a6 7. O-O Nf6 8. Be3 Bb4 9. Na4 Be7 10. Nxc6 bxc6 11. Nb6 Rb8 12. Nxc8 Qxc8',
    ),
    chapter(
      '6.g3',
      '1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 Qc7 6. g3 a6 7. Bg2 Nf6 8. O-O Be7 9. Re1 d6 10. Nxc6 bxc6 11. e5 dxe5 12. Rxe5 O-O',
    ),
    chapter(
      '3.Nc3 move order',
      '1. e4 c5 2. Nf3 e6 3. Nc3 Nc6 4. d4 cxd4 5. Nxd4 Qc7 6. Be3 a6 7. Qd2 Nf6 8. O-O-O Bb4 9. f3 Ne5 10. Nb3 b5',
    ),
    chapter(
      'Alapin',
      '1. e4 c5 2. c3 d5 3. exd5 Qxd5 4. d4 Nf6 5. Nf3 e6 6. Be2 Nc6 7. O-O cxd4 8. cxd4 Be7 9. Nc3 Qd6 10. Be3 O-O 11. Qd2 b6 12. Rad1 Bb7',
    ),
    chapter(
      'Smith-Morra',
      '1. e4 c5 2. d4 cxd4 3. c3 d5 4. exd5 Qxd5 5. cxd4 Nc6 6. Nf3 Bg4 7. Nc3 Bxf3 8. gxf3 Qxd4 9. Qxd4 Nxd4 10. Nb5 Nc6 11. Nc7+ Kd7 12. Nxa8 e5',
    ),
  ],
};

/** docs/personas/1400-2000.md, "Slavų gynyba". */
const SLAV: PersonaRepertoire = {
  handle: 'slav',
  owner: 'coach',
  side: 'black',
  name: 'Slavų gynyba',
  chapters: [
    chapter(
      'Main line 5.a4',
      '1. d4 d5 2. c4 c6 3. Nf3 Nf6 4. Nc3 dxc4 5. a4 Bf5 6. e3 e6 7. Bxc4 Bb4 8. O-O Nbd7 9. Qe2 Bg6 10. e4 O-O 11. Bd3 Bh5',
    ),
    chapter(
      '4.e3 Bf5',
      '1. d4 d5 2. c4 c6 3. Nf3 Nf6 4. e3 Bf5 5. Nc3 e6 6. Nh4 Bg6 7. Nxg6 hxg6 8. Bd3 Nbd7 9. O-O Bd6 10. h3 dxc4 11. Bxc4 O-O 12. Qe2',
    ),
    chapter(
      'Exchange',
      '1. d4 d5 2. c4 c6 3. cxd5 cxd5 4. Nc3 Nf6 5. Bf4 Nc6 6. e3 Bf5 7. Nf3 e6 8. Bb5 Nd7 9. Qa4 Rc8 10. O-O a6 11. Bxc6 Rxc6 12. Rfc1',
    ),
    chapter(
      'vs London',
      '1. d4 d5 2. Bf4 c6 3. e3 Bf5 4. Nf3 e6 5. c4 Nd7 6. Nc3 Ngf6 7. Qb3 Qb6 8. c5 Qxb3 9. axb3 a6 10. b4 Be7',
    ),
  ],
};

/** docs/personas/coach.md, "Karo-Kan gynyba: pagrindai" (the group assignment). */
const CARO_KANN: PersonaRepertoire = {
  handle: 'caro-kann',
  owner: 'coach',
  side: 'black',
  name: 'Karo-Kan gynyba: pagrindai',
  chapters: [
    chapter(
      'Advance, Short variation',
      '1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nf3 e6 5. Be2 c5 6. Be3 Nd7 7. O-O Ne7 8. c4 dxc4 9. Na3 Nd5 10. Nxc4 Nxe3 11. Nxe3 Be4',
    ),
    chapter(
      'Classical',
      '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7 8. h5 Bh7 9. Bd3 Bxd3 10. Qxd3 e6',
    ),
    chapter(
      'Exchange',
      '1. e4 c6 2. d4 d5 3. exd5 cxd5 4. Bd3 Nc6 5. c3 Nf6 6. Bf4 Bg4 7. Qb3 Qd7 8. Nd2 e6 9. Ngf3 Bd6 10. Bxd6 Qxd6',
    ),
    chapter(
      'Panov',
      '1. e4 c6 2. d4 d5 3. exd5 cxd5 4. c4 Nf6 5. Nc3 e6 6. Nf3 Be7 7. cxd5 Nxd5 8. Bd3 Nc6 9. O-O O-O 10. Re1 Bf6',
    ),
    chapter(
      'Two Knights',
      '1. e4 c6 2. Nc3 d5 3. Nf3 Bg4 4. h3 Bxf3 5. Qxf3 e6 6. d4 Nf6 7. Bd3 dxe4 8. Nxe4 Qxd4 9. c3 Qd8 10. O-O Nbd7',
    ),
  ],
};

/**
 * docs/personas/coach.md, "Own training": the Catalan main line from
 * 2000plus.md, its first 12 moves.
 */
const COACH_CATALAN: PersonaRepertoire = {
  handle: 'coach-catalan',
  owner: 'coach',
  side: 'white',
  name: 'Katalonų pradžia',
  chapters: [
    chapter(
      'Open 7.Qc2 a6 8.Qxc4',
      '1. d4 Nf6 2. c4 e6 3. g3 d5 4. Bg2 Be7 5. Nf3 O-O 6. O-O dxc4 7. Qc2 a6 8. Qxc4 b5 9. Qc2 Bb7 10. Bd2 Be4 11. Qc1 Bb7 12. Bf4 Nd5',
    ),
  ],
};

/** Every persona repertoire, in the order they are made. */
export const PERSONA_REPERTOIRES: readonly PersonaRepertoire[] = [
  ITALIAN,
  OPEN_GAMES,
  QGD,
  QUEENS_GAMBIT,
  SLAV,
  NAJDORF,
  NAJDORF_E6,
  CARO_KANN,
  COACH_CATALAN,
  LONDON,
  TAIMANOV,
  CATALAN,
  CATALAN_A4,
  NAJDORF_NG4,
  NIMZO,
];
