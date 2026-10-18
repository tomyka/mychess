import { createHash, randomBytes } from 'node:crypto';

/** A fresh invite token: 32 random bytes, base64url, 43 characters. */
export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What the database keeps of a token (checklist 5): its SHA-256, hex. */
export function inviteTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
