import type { MessageKeys, NestedKeyOf } from 'next-intl';
import { z } from 'zod';
import type { MESSAGES } from './locales';

type Messages = (typeof MESSAGES)['lt'];

/** A dotted key of a message in the catalogue (what `t` takes). */
export type MessageKey = MessageKeys<Messages, NestedKeyOf<Messages>>;

const groupSchema = z.record(z.string(), z.unknown());

/**
 * Is `key` a message in `messages` (a client's `useMessages()`)? Refusal
 * reasons travel as plain strings; this lets the page translate one it
 * knows and fall back for any other.
 */
export function isMessageKey(
  messages: unknown,
  key: string,
): key is MessageKey {
  let node = messages;
  for (const part of key.split('.')) {
    const group = groupSchema.safeParse(node);
    if (!group.success) return false;
    node = group.data[part];
  }
  return typeof node === 'string';
}
