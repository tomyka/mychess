import { ADMIN_ACTIONS } from '@mychess/domain';
import { sql } from 'drizzle-orm';
import { check, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { at, oneOf } from '../schema-columns';

/**
 * Append-only record of every Admin action (security item 8). No foreign
 * key: the row outlives the account it is about. It names the target by id
 * and by a one-way hash of its email, never the address (R-88).
 */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: serial('id').primaryKey(),
    action: text('action', { enum: ADMIN_ACTIONS }).notNull(),
    targetAccountId: text('target_account_id').notNull(),
    /** auditEmailHash (keyed, R-94) of the target's canonical email. */
    targetEmailHash: text('target_email_hash').notNull(),
    actor: text('actor').notNull(),
    at: at('at').notNull(),
  },
  (t) => [
    check('admin_audit_action_check', oneOf(t.action, ADMIN_ACTIONS)),
    // A backstop for auditEmailHash: a hex HMAC-SHA-256, so no address fits.
    check(
      'admin_audit_target_email_hash_check',
      sql`${t.targetEmailHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
