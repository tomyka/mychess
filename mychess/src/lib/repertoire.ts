/** Unions a player's own repertoire ids with those assigned by a coach, de-duplicated. */
export function mergeRepertoireIds(own: string[], assigned: string[]): string[] {
  return [...new Set([...own, ...assigned])];
}
