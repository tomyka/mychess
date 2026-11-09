/**
 * The repertoires of docs/personas/2000plus.md (Dovydas's own and the
 * coach's two Najdorfs), line for line; see repertoires.ts. Pure data.
 */
import { chapter, type ChapterLines, type PersonaRepertoire } from './lines';

/** "Katalonų pradžia" (Dovydas's own, private). */
export const CATALAN: PersonaRepertoire = {
  handle: 'catalan',
  owner: '2000plus',
  side: 'white',
  name: 'Katalonų pradžia',
  chapters: [
    chapter(
      'Open 7.Qc2 a6 8.Qxc4',
      '1. d4 Nf6 2. c4 e6 3. g3 d5 4. Bg2 Be7 5. Nf3 O-O 6. O-O dxc4 7. Qc2 a6 8. Qxc4 b5 9. Qc2 Bb7 10. Bd2 Be4 11. Qc1 Bb7 12. Bf4 Nd5 13. Nc3 Nxf4 14. Qxf4 Bd6 15. Qd2 Nd7 16. Rfd1 Qe7 17. Rac1 Rfd8 18. e4 b4 19. Na4 a5 20. Rc2 Rab8 21. Rdc1 Ba8',
    ),
    chapter(
      '6...c5',
      '1. d4 Nf6 2. c4 e6 3. g3 d5 4. Bg2 Be7 5. Nf3 O-O 6. O-O c5 7. cxd5 Nxd5 8. Nc3 Nc6 9. dxc5 Bxc5 10. Nxd5 exd5 11. a3 Bf5 12. b4 Bb6 13. Bb2 Re8 14. Rc1 Rc8 15. e3 Be4 16. Qd2 Qe7 17. Rfd1 Rcd8 18. Bd4 Bxd4 19. Nxd4 Nxd4 20. Qxd4 Bxg2 21. Kxg2',
    ),
    chapter(
      'Closed 6...Nbd7',
      '1. d4 Nf6 2. c4 e6 3. g3 d5 4. Bg2 Be7 5. Nf3 O-O 6. O-O Nbd7 7. Qc2 c6 8. Nbd2 b6 9. e4 Bb7 10. b3 Rc8 11. Bb2 Qc7 12. Rad1 Qb8 13. Rfe1 Rfd8 14. e5 Ne8 15. Nf1 c5 16. Ne3 Nc7 17. h4 cxd4 18. Nxd4 dxc4 19. Nxc4 Nd5 20. Qe4 Nc5 21. Qg4',
    ),
    chapter(
      '3...Bb4+',
      '1. d4 Nf6 2. c4 e6 3. g3 Bb4+ 4. Bd2 Be7 5. Bg2 d5 6. Nf3 O-O 7. O-O c6 8. Qc2 b6 9. Bf4 Ba6 10. Nbd2 Nbd7 11. Rfd1 Rc8 12. e4 c5 13. exd5 exd5 14. Rac1 Re8 15. Qa4 Bb7 16. dxc5 Nxc5 17. Qc2 Ne6 18. Be5 dxc4 19. Nxc4 Bxf3 20. Bxf3 Bc5 21. Qa4',
    ),
    {
      // The doc keeps the sidelines in one chapter of this name.
      name: '1...g6 / 1...c5 / 1...f5',
      lines: [
        '1. d4 Nf6 2. c4 g6 3. g3 d5 4. cxd5 Nxd5 5. Bg2 Bg7 6. e4 Nb6 7. Ne2 c5 8. d5 e6 9. O-O O-O 10. Nec3 exd5 11. exd5 Na6 12. Na3 Bf5 13. Nab5 Qd7 14. a4 Rfd8 15. Bf4 Nb4 16. Re1 a6 17. Nd6 Bg4 18. Qd2 N4xd5 19. Nxd5 Nxd5 20. Bxd5 Qxd6 21. Bxd6 Rxd6',
        '1. d4 Nf6 2. c4 g6 3. g3 Bg7 4. Bg2 O-O 5. Nc3 d6 6. Nf3 Nbd7 7. O-O e5 8. e4 c6 9. h3 Qb6 10. Re1 exd4 11. Nxd4 Re8 12. Rb1 Nc5 13. Be3 a5 14. Qc2 Nfd7 15. Rbd1 Ne5 16. b3 a4 17. Rb1 axb3 18. axb3 Qc7 19. f4 Ne6 20. Nde2 Nd7 21. Qd2',
        '1. d4 Nf6 2. c4 c5 3. d5 e6 4. Nc3 exd5 5. cxd5 d6 6. e4 g6 7. Nf3 Bg7 8. h3 O-O 9. Bd3 b5 10. Nxb5 Re8 11. O-O Nxe4 12. Re1 a6 13. Na3 Nf6 14. Rxe8+ Nxe8 15. Bg5 Qb6 16. Nc4 Qb4',
        '1. d4 f5 2. g3 Nf6 3. Bg2 e6 4. Nf3 d5 5. O-O Bd6 6. c4 c6 7. b3 Qe7 8. Ne5 O-O 9. Bb2 b6 10. Nd2 Bb7 11. Rc1 Nbd7 12. Nd3 a5 13. e3 Rac8 14. Re1 Ba6',
      ],
    },
  ],
};

/** "Katalonų pradžia: 8.a4 sistema" (own, private). */
export const CATALAN_A4: PersonaRepertoire = {
  handle: 'catalan-a4',
  owner: '2000plus',
  side: 'white',
  name: 'Katalonų pradžia: 8.a4 sistema',
  chapters: [
    chapter(
      'Open 8.a4 Bd7',
      '1. d4 Nf6 2. c4 e6 3. g3 d5 4. Bg2 Be7 5. Nf3 O-O 6. O-O dxc4 7. Qc2 a6 8. a4 Bd7 9. Qxc4 Bc6 10. Bf4 a5 11. Nc3 Na6 12. Rfd1 Bd5 13. Qd3 Nb4 14. Qd2 c6 15. Nxd5 Nbxd5 16. Be5 Nd7 17. e4 N5b6 18. Qe2 Nxe5 19. dxe5 Qc7 20. Rac1 Rfd8 21. Rxd8+ Rxd8',
    ),
  ],
};

/** The coach's "Naidorfo variantas" chapters (assigned to Dovydas, forked). */
export const NAJDORF: PersonaRepertoire = {
  handle: 'najdorf',
  owner: 'coach',
  side: 'black',
  name: 'Naidorfo variantas',
  chapters: [
    chapter(
      'EA 6...e5',
      '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. f3 Be7 9. Qd2 O-O 10. O-O-O Nbd7 11. g4 b5 12. g5 b4 13. Ne2 Ne8 14. f4 a5 15. f5 a4 16. Nbd4 exd4 17. Nxd4 b3 18. Kb1 bxc2+ 19. Nxc2 Bb3 20. axb3 axb3 21. Na3 Ne5',
    ),
    chapter(
      'Poisoned Pawn',
      '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Bg5 e6 7. f4 Qb6 8. Qd2 Qxb2 9. Rb1 Qa3 10. f5 Nc6 11. fxe6 fxe6 12. Nxc6 bxc6 13. e5 dxe5 14. Bxf6 gxf6 15. Ne4 Be7 16. Be2 h5 17. Rb3 Qa4 18. Nxf6+ Bxf6 19. c4 Bh4+ 20. g3 Be7 21. O-O Ra7',
    ),
    chapter(
      '6.Be2',
      '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5 7. Nb3 Be7 8. O-O O-O 9. Be3 Be6 10. Qd2 Nbd7 11. a4 Rc8 12. a5 Qc7 13. Rfd1 Rfe8 14. Nc1 Bc4 15. Bxc4 Qxc4 16. N1e2 h6 17. f3 Bf8 18. Ng3 Qc6 19. Qd3 Nc5 20. Qe2 Ne6 21. Rd2',
    ),
  ],
};

/** The chapters Dovydas added to his fork only. */
export const NAJDORF_FORK_CHAPTERS: readonly ChapterLines[] = [
  chapter(
    '6.h3',
    '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. h3 e5 7. Nde2 h5 8. g3 Be6 9. Bg2 Nbd7 10. a4 Be7 11. Be3 O-O 12. O-O Rc8 13. Nd5 Bxd5 14. exd5 Nb6 15. b3 Nbd7 16. a5 Qc7',
  ),
  chapter(
    '6.Bc4',
    '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Bc4 e6 7. Bb3 b5 8. O-O Be7 9. Qf3 Qc7 10. Qg3 O-O 11. Bh6 Ne8 12. Rad1 Bd7 13. Nf3 Nc6 14. Bf4 Qb7',
  ),
  chapter(
    'Moscow 3.Bb5+',
    '1. e4 c5 2. Nf3 d6 3. Bb5+ Bd7 4. Bxd7+ Qxd7 5. c4 Nc6 6. Nc3 g6 7. d4 cxd4 8. Nxd4 Bg7 9. Be3 Nf6 10. f3 O-O 11. O-O a6 12. Nde2 Qe6 13. b3 Rfc8',
  ),
  chapter(
    'Alapin',
    '1. e4 c5 2. c3 Nf6 3. e5 Nd5 4. d4 cxd4 5. Nf3 Nc6 6. cxd4 d6 7. Bc4 Nb6 8. Bb5 dxe5 9. Nxe5 Bd7 10. Nxd7 Qxd7 11. Nc3 e6 12. O-O Be7 13. Qg4 O-O 14. Bd3 f5',
  ),
  chapter(
    'Grand Prix',
    '1. e4 c5 2. Nc3 d6 3. f4 g6 4. Nf3 Bg7 5. Bc4 Nc6 6. O-O e6 7. d3 Nge7 8. Qe1 O-O 9. Bb3 Na5 10. Qh4 Nxb3 11. axb3 b6 12. f5 exf5',
  ),
];

/** "Naidorfo variantas: 6.Be3 e6" (the coach's, assigned, not forked). */
export const NAJDORF_E6: PersonaRepertoire = {
  handle: 'najdorf-e6',
  owner: 'coach',
  side: 'black',
  name: 'Naidorfo variantas: 6.Be3 e6',
  chapters: [
    chapter(
      'EA 6...e6',
      '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e6 7. f3 b5 8. Qd2 Nbd7 9. g4 h6 10. O-O-O Bb7 11. h4 b4 12. Na4 Qa5 13. b3 Nc5 14. a3 Nxa4 15. axb4 Qc7 16. bxa4 d5 17. e5 Nd7 18. f4 Nb6 19. Rh3 Nxa4 20. Kb1 Rc8 21. Qd3 Nc3+',
    ),
  ],
};

/** "Naidorfo variantas: 6.Be3 Ng4" (own, private). */
export const NAJDORF_NG4: PersonaRepertoire = {
  handle: 'najdorf-ng4',
  owner: '2000plus',
  side: 'black',
  name: 'Naidorfo variantas: 6.Be3 Ng4',
  chapters: [
    chapter(
      '6.Be3 Ng4',
      '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 Ng4 7. Bg5 h6 8. Bh4 g5 9. Bg3 Bg7 10. Be2 h5 11. Bxg4 Bxg4 12. f3 Bd7 13. Qd2 Nc6 14. Nb3 b5 15. a4 b4 16. Nd5 e6 17. Ne3 h4 18. Bf2 Qa5 19. Nc4 Qc7 20. O-O Ne5 21. Nxe5 Bxe5',
    ),
  ],
};

/** The Nimzo-Indian and Queen's Indian (own, private). */
export const NIMZO: PersonaRepertoire = {
  handle: 'nimzo',
  owner: '2000plus',
  side: 'black',
  name: 'Nimcovičiaus gynyba ir Damų indų gynyba',
  chapters: [
    chapter(
      'Nimzo 4.Qc2',
      '1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. Qc2 O-O 5. a3 Bxc3+ 6. Qxc3 b6 7. Bg5 Bb7 8. f3 h6 9. Bh4 d5 10. e3 Nbd7 11. cxd5 Nxd5 12. Bxd8 Nxc3 13. Bh4 Nd5 14. Bf2 c5 15. e4 Ne7 16. Ne2 Rfc8 17. Nc3 cxd4 18. Bxd4 Nc5 19. Bb5 a6 20. Be2 Nc6 21. Bxc5 bxc5',
    ),
    chapter(
      'Nimzo 4.e3',
      '1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. e3 O-O 5. Bd3 d5 6. Nf3 c5 7. O-O Nc6 8. a3 Bxc3 9. bxc3 dxc4 10. Bxc4 Qc7 11. Bd3 e5 12. Qc2 Re8 13. Nxe5 Nxe5 14. dxe5 Qxe5 15. f3 Be6 16. e4 c4 17. Be2 Rad8 18. Be3 Qc7 19. Rad1 h6 20. Rxd8 Rxd8 21. Rd1',
    ),
    chapter(
      'Nimzo 4.f3',
      '1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. f3 d5 5. a3 Be7 6. e4 dxe4 7. fxe4 e5 8. d5 Bc5 9. Nf3 Ng4 10. Qe2 O-O 11. h3 Nf6 12. Bg5 h6 13. Bh4 a5',
    ),
    chapter(
      'Nimzo 4.Bg5',
      '1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. Bg5 h6 5. Bh4 c5 6. d5 d6 7. e3 Bxc3+ 8. bxc3 e5 9. Qc2 Nbd7 10. Bd3 Qe7 11. Ne2 g5 12. Bg3 Nh5 13. O-O Nxg3 14. Nxg3 Nf6',
    ),
    chapter(
      'QID 4.g3 Ba6',
      '1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. g3 Ba6 5. b3 Bb4+ 6. Bd2 Be7 7. Bg2 c6 8. Bc3 d5 9. Ne5 Nfd7 10. Nxd7 Nxd7 11. Nd2 O-O 12. O-O Rc8 13. e4 b5 14. Re1 dxc4 15. bxc4 Nb6 16. cxb5 cxb5 17. Rc1 b4 18. Bb2 Rxc1 19. Bxc1 Qc7 20. Bb2 Rc8 21. Nf3',
    ),
    chapter(
      'QID Petrosian',
      '1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. a3 Bb7 5. Nc3 d5 6. cxd5 Nxd5 7. Qc2 Nxc3 8. bxc3 Be7 9. e4 O-O 10. Bd3 c5 11. O-O Qc8 12. Qe2 Ba6 13. Rd1 cxd4 14. cxd4 Bxd3 15. Rxd3 Nc6',
    ),
    chapter(
      'vs London',
      '1. d4 Nf6 2. Bf4 e6 3. e3 c5 4. Nd2 Nc6 5. c3 d5 6. Ngf3 Bd6 7. Bg3 O-O 8. Bd3 b6 9. e4 cxd4 10. e5 Be7 11. cxd4 Nb4 12. Bb1 a5 13. O-O Ba6 14. Re1 Nd3',
    ),
    chapter(
      'Mikenas',
      '1. c4 Nf6 2. Nc3 e6 3. e4 d5 4. e5 d4 5. exf6 dxc3 6. bxc3 Qxf6 7. d4 c5 8. Nf3 h6 9. Bd3 cxd4 10. cxd4 Bb4+ 11. Bd2 Bxd2+ 12. Qxd2 Nc6',
    ),
  ],
};
