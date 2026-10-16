// Lithuanian ECO opening names, one per code, from šachmatai.lt's opening
// encyclopaedia (http://www.xn--achmatai-4wb.lt/debiutu_enciklopedija.php).
// English names come from a different source: see `eco.ts`.
//
// The data is `eco-lt.json`, written by `scripts/generate-eco-lt.mjs`; do not
// edit it by hand: a fix goes into the generator or its input. Names are
// stored verbatim, including the move disambiguation many of them carry
// ("Benoni gynyba, 6.e4", "be 9.O-O") in Lithuanian piece notation (v1 #158).
import data from './eco-lt.json';

/** ECO code -> Lithuanian name. */
export const ECO_LT: Readonly<Record<string, string>> = data;
