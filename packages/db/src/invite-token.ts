// Invite tokens and what the database keeps of them. Internal to the
// package: callers hand over the raw token and never learn how it is stored.
import { inviteTokenSchema } from '@mychess/domain';
import { createHash, randomBytes } from 'node:crypto';

/** A fresh invite token: 32 random bytes, base64url, 43 characters. */
export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What the database keeps of a token (checklist 5): its SHA-256, hex. */
export function inviteTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * The stored hash of `token` as a link carries it, or undefined when it is
 * not a token at all: a malformed one names no invite, so it needs no
 * lookup (plan decision 6).
 */
export function parsedTokenHash(token: string): string | undefined {
  return inviteTokenSchema.safeParse(token).success
    ? inviteTokenHash(token)
    : undefined;
}
