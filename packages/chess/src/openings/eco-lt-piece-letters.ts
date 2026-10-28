// Piece-letter corrections for šachmatai.lt's Lithuanian opening names
// (ruling R-161), applied by `scripts/generate-eco-lt.mjs` after the safe
// tidy of R-77. A few names write a move with the English piece letter. The
// Lithuanian letters are K karalius, V valdovė, B bokštas (rook), R rikis
// (bishop), Ž žirgas, so B and R mean different pieces in the two languages
// and no letter can be swapped blindly: each correction names its ECO code
// and the exact text, checked against the move order of that ECO line.

/** One exact replacement inside one code's name. */
export interface PieceLetterCorrection {
  readonly wrong: string;
  readonly right: string;
}

/** ECO code -> its corrections, reviewed by i18n-content. */
export const PIECE_LETTER_CORRECTIONS: Readonly<
  Record<string, readonly PieceLetterCorrection[]>
> = {
  // ...10.Bc2 c5 11.d4 Qc7 12.Nbd2 Nc6: the knight.
  C98: [{ wrong: '12...Nc6', right: '12...Žc6' }],
  // 6.Bg5 e6 7.f4 Be7: the bishop.
  B99: [{ wrong: '7...Be7', right: '7...Re7' }],
  // 4.Nf3 Bg7 5.e3 O-O 6.Qb3: the queen.
  D95: [{ wrong: '6.Qb3', right: '6.Vb3' }],
  // 4.e3 O-O 5.Bd3 d5: the bishop.
  E48: [{ wrong: '5.Bd3', right: '5.Rd3' }],
};

/** The name of `code` with its listed piece letters corrected. */
export function correctPieceLetters(code: string, name: string): string {
  return (PIECE_LETTER_CORRECTIONS[code] ?? []).reduce(
    (corrected, { wrong, right }) => corrected.replace(wrong, right),
    name,
  );
}
