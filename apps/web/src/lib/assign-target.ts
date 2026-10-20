/** What an assignment is given to: a linked player or one of the coach's groups. */
export type TargetKind = 'player' | 'group';

/** The assign picker's option value for a player or a group: `kind:id`. */
export const targetField = (kind: TargetKind, id: string): string =>
  `${kind}:${id}`;

/**
 * The picker's value as the target object the input schema parses;
 * undefined when nothing is picked. Anything else is passed on as it reads,
 * for the schema to refuse.
 */
export function targetFromField(
  raw: unknown,
): Readonly<Record<string, string>> | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  const at = raw.indexOf(':');
  const kind = at < 0 ? raw : raw.slice(0, at);
  const id = at < 0 ? '' : raw.slice(at + 1);
  return kind === 'group' ? { kind, groupId: id } : { kind, playerId: id };
}
