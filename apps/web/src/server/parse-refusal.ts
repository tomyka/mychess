// A failed parse read as a refusal the UI can translate. A zod issue's
// message is a message-catalogue key (CLAUDE.md), so the refusal is the
// first issue's message when the caller knows it, or what the first issue's
// field reads as; anything else falls back to the caller's key.
import type { Result } from '@mychess/domain';
import type { z } from 'zod';
import type { MessageKey } from '../i18n/message-key';

/** One of `known` if the first issue's message is one, else `fallback`. */
export function refusalOf<K extends MessageKey>(
  error: z.ZodError,
  known: readonly K[],
  fallback: K,
): K {
  const message = error.issues[0]?.message;
  return known.find((key) => key === message) ?? fallback;
}

/** A field's refusal: a key, or one read from the error (say, its message). */
export type FieldRefusal<K extends MessageKey> = K | ((error: z.ZodError) => K);

/**
 * What the first issue's field reads as: the entry of `fields` named by the
 * longest prefix of its dotted path (`target.groupId`, then `target`), else
 * `fallback`.
 *
 * The field names are plain strings, not checked against the schema's
 * shape: typing every dotted path of a zod schema costs more than it
 * catches here. A misspelt or renamed field reads as `fallback`, so each
 * caller's tests pin one refusal per field it names.
 */
export function refusalAt<K extends MessageKey>(
  error: z.ZodError,
  fields: Readonly<Record<string, FieldRefusal<K>>>,
  fallback: K,
): K {
  const path = (error.issues[0]?.path ?? []).map(String);
  for (let length = path.length; length > 0; length -= 1) {
    const field = path.slice(0, length).join('.');
    const entry = Object.hasOwn(fields, field) ? fields[field] : undefined;
    if (entry !== undefined)
      return typeof entry === 'function' ? entry(error) : entry;
  }
  return fallback;
}

/** What a form shows after a result: nothing, or the refusal's reason. */
export function refusalState<R extends { readonly reason: MessageKey }>(
  result: Result<unknown, R>,
): { readonly refusal?: R['reason'] } {
  return result.ok ? {} : { refusal: result.refusal.reason };
}
