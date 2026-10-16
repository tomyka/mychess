import { createHash } from 'node:crypto';

/**
 * The one-way hash an Admin audit row stores instead of the target's email
 * (R-88): hex SHA-256 of the canonical email. An operator asks "was this
 * email ever audited" by canonicalising it (domain canonicalEmail), hashing
 * it here and looking for the hash in admin_audit.target_email_hash.
 * `email` must already be canonical, as the audit writer's is.
 */
export function auditEmailHash(email: string): string {
  return createHash('sha256').update(email, 'utf8').digest('hex');
}
