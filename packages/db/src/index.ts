import {
  accounts,
  providerAccounts,
  rateLimits,
  sessions,
  verifications,
} from './schema';

export {
  exportAccount,
  type AccountExport,
  type AccountExportOptions,
  type CoachingExport,
} from './account-export';
export {
  completeOnboarding,
  deleteAccount,
  findAccountByEmail,
  findAccountById,
  updateProfile,
} from './accounts';

export { disableAccount, grantAdmin, type AdminInput } from './admin';
export { auditEmailHash } from './audit-email';

export {
  createDb,
  ping,
  type Db,
  type DbHandle,
  type Executor,
  type Tx,
} from './client';
export {
  coachAccessFacts,
  coachPlayer,
  coachPlayers,
  playerCoaches,
  startCoaching,
  stopCoaching,
  unlink,
  type GroupRef,
  type LinkedAccount,
} from './coaching';
export { databaseEnvSchema, databaseUrlSchema } from './config';
export {
  addMember,
  coachGroup,
  coachGroups,
  createGroup,
  deleteGroup,
  leaveGroup,
  removeMember,
  renameGroup,
  type CoachGroup,
  type CoachGroupSummary,
  type GroupMember,
  type Membership,
} from './groups';
export { inviteTokenHash } from './invite-token';
export {
  acceptInvite,
  coachInvites,
  createInvite,
  previewInvite,
  revokeInvite,
  type AcceptedInvite,
  type CoachInvite,
  type CreatedInvite,
  type InvitePreview,
  type InviteRequest,
} from './invites';

export {
  listPersonalNotes,
  setPersonalNote,
  type PersonalNoteInput,
} from './personal-notes';
export {
  createRepertoire,
  deleteRepertoire,
  listRepertoires,
  loadRepertoire,
  renameRepertoire,
  saveRepertoireEdit,
  type LoadedRepertoire,
  type NewRepertoire,
  type RepertoireEdit,
  type RepertoireListItem,
  type RepertoireRename,
} from './repertoires/repository';

/** Better Auth's tables, keyed by the model names auth.ts maps them to. */
export const authSchema = {
  accounts,
  sessions,
  providerAccounts,
  verifications,
  rateLimits,
};
