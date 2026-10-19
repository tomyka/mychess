// Notes kept by move key, as the repertoire screens hold them in state: the
// viewer's Personal notes on the owner's page, the coach's own notes on a
// shared repertoire. Pure, so either screen can use it.

/** `notes` with the note on `key` set, or removed when `text` is empty. */
export function withNote(
  notes: Readonly<Record<string, string>>,
  key: string,
  text: string,
): Record<string, string> {
  const next = Object.fromEntries(
    Object.entries(notes).filter(([k]) => k !== key),
  );
  return text === '' ? next : { ...next, [key]: text };
}
