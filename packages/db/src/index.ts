import { accounts, providerAccounts, sessions, verifications } from './schema';

export {
  completeOnboarding,
  deleteAccount,
  exportAccount,
  findAccountByEmail,
  findAccountById,
  updateProfile,
  type AccountExport,
} from './accounts';

export { disableAccount, grantAdmin } from './admin';

export {
  createDb,
  ping,
  type Db,
  type DbHandle,
  type Executor,
  type Tx,
} from './client';
export { databaseEnvSchema, databaseUrlSchema } from './config';

/** Better Auth's tables, keyed by the model names auth.ts maps them to. */
export const authSchema = {
  accounts,
  sessions,
  providerAccounts,
  verifications,
};
