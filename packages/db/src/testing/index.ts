// Test-only entry point (`@mychess/db/testing`): the test database's whole
// life, for the db suite and any later suite that needs a real Postgres,
// and the audit email key tests hash with. `inviteTokenHash` is here for
// fixtures that write invite rows directly: runtime callers hand the raw
// token to previewInvite and acceptInvite and never see how it is stored.
// Never imported by runtime code; lint enforces that (eslint.config.mjs).
export { inviteTokenHash } from '../invite-token';
export { TEST_AUDIT_EMAIL_KEY } from './audit-key';
export {
  startTestDatabase,
  useTestDatabase,
  type TestDatabase,
  type TestDatabaseConnection,
} from './database';
