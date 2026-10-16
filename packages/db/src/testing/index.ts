// Test-only entry point (`@mychess/db/testing`): the test database's whole
// life, for the db suite and any later suite that needs a real Postgres,
// and the audit email key tests hash with.
// Never imported by runtime code; lint enforces that (eslint.config.mjs).
export { TEST_AUDIT_EMAIL_KEY } from './audit-key';
export {
  startTestDatabase,
  useTestDatabase,
  type TestDatabase,
  type TestDatabaseConnection,
} from './database';
