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
