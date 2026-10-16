import { createHmac } from 'node:crypto';

/**
 * The keyed one-way hash an Admin audit row stores instead of the target's
 * email (R-88, R-94): hex HMAC-SHA-256 of the canonical email under the
 * environment's AUDIT_EMAIL_KEY, so a leaked database alone cannot confirm a
 * guessed email. An operator asks "was this email ever audited" by
 * canonicalising it (domain canonicalEmail), hashing it here with the same
 * key and looking for the hash in admin_audit.target_email_hash.
 * `email` must already be canonical, as the audit writer's is.
 */
export function auditEmailHash(email: string, key: string): string {
  return createHmac('sha256', key).update(email, 'utf8').digest('hex');
}
