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
export { deleteAccount } from './account-delete';
export {
  completeOnboarding,
  findAccountByEmail,
  findAccountById,
  updateProfile,
} from './accounts';

export { disableAccount, grantAdmin, type AdminInput } from './admin';
export {
  assign,
  setDeadline,
  unassign,
  type AssignmentRef,
  type AssignRequest,
  type DeadlineChange,
} from './assignments/assign';
export {
  assignedPlayerCount,
  coachAssignments,
  type CoachAssignment,
  type CoachAssignmentPlayer,
} from './assignments/coach';
export {
  forkAssignment,
  forkCoachNotesOn,
  type ForkCoachNote,
  type ForkRequest,
} from './assignments/fork';
export {
  acceptForkOffer,
  declineForkOffer,
  type ForkOfferRef,
} from './assignments/offer-answers';
export { openForkOffers, type OpenForkOffer } from './assignments/offers';
export {
  assignedRepertoireForPlayer,
  changesSince,
  playerAssignments,
  trainingRepertoires,
  type AssignedRepertoire,
  type ChangesRequest,
  type ChangesSince,
  type PlayerAssignment,
} from './assignments/player';
export {
  markSeen,
  pauseAssignment,
  type PauseRequest,
  type SeenRequest,
} from './assignments/player-state';
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
  sharedRepertoireSnapshot,
  startCoaching,
  stopCoaching,
  unlink,
  type GroupRef,
  type LinkedAccount,
  type SharedRepertoireSnapshot,
} from './coaching';
export {
  coachNotesOn,
  deleteCoachNote,
  upsertCoachNote,
  type CoachNote,
  type CoachNoteInput,
  type CoachNoteRemoval,
} from './coach-notes';
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
  setAssignedPersonalNote,
  setPersonalNote,
  type PersonalNoteInput,
} from './personal-notes';
export { countRateLimited, pruneRateLimits } from './rate-limits';
export { deleteRepertoire } from './repertoires/delete';
export {
  editRepertoire,
  type EditedRepertoire,
  type EditRepertoireRefusal,
  type RepertoireEditRequest,
} from './repertoires/edit';
export {
  createRepertoire,
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
export {
  setShares,
  shareRepertoire,
  sharedCoachIds,
  sharedRepertoireForCoach,
  sharedWithCoach,
  unshareRepertoire,
  type SharedRepertoire,
  type SharedRepertoireItem,
  type ShareRequest,
  type SharesRequest,
  type SharesSet,
  type ShareTarget,
} from './shares';

/** Better Auth's tables, keyed by the model names auth.ts maps them to. */
export const authSchema = {
  accounts,
  sessions,
  providerAccounts,
  verifications,
  rateLimits,
};
