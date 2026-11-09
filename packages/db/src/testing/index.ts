// Test-only entry point (`@mychess/db/testing`): the test database's whole
// life, for the db suite and any later suite that needs a real Postgres,
// and the audit email key tests hash with. `inviteTokenHash` is here for
// fixtures that write invite rows directly: runtime callers hand the raw
// token to previewInvite and acceptInvite and never see how it is stored.
// Never imported by runtime code; lint enforces that (eslint.config.mjs).
export { inviteTokenHash } from '../invite-token';
export { TEST_AUDIT_EMAIL_KEY } from './audit-key';
// The persona seed (S8 lead decision 3): the definitions, for E2E fixtures,
// and the seed itself; the seed:personas script runs it on the local stack.
export {
  PERSONA_ACCOUNTS,
  PERSONA_GROUP,
  PERSONA_LINKS,
  type PersonaAccount,
  type PersonaKey,
} from './personas/accounts';
export {
  PERSONA_ASSIGNMENTS,
  PERSONA_FORKS,
  PERSONA_NOTES,
  PERSONA_SHARES,
  PERSONA_TRAINING,
} from './personas/definitions';
export { type PersonaRepertoire } from './personas/lines';
export { PERSONA_REPERTOIRES } from './personas/repertoires';
export { seedPersonas, type SeedSummary } from './personas/seed';
export {
  startTestDatabase,
  useTestDatabase,
  type TestDatabase,
  type TestDatabaseConnection,
} from './database';
