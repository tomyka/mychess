// mychess/src/lib/fide/names.ts

/** Case/whitespace-insensitive comparison between a profile's name and its claimed FIDE profile's name. */
export function namesMatch(firstName: string, lastName: string, fideFirstName: string, fideLastName: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase();
  return normalize(firstName) === normalize(fideFirstName) && normalize(lastName) === normalize(fideLastName);
}
