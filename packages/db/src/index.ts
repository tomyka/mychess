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
  deleteAccount,
  deleteConfirmedAccount,
  type DeletionRequest,
} from './account-delete';
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
  changesSince,
  type ChangesRequest,
  type ChangesSince,
} from './assignments/player-changes';
export {
  playerAssignments,
  type PlayerAssignment,
} from './assignments/player-list';
export {
  assignedRepertoireForPlayer,
  type AssignedRepertoire,
} from './assignments/player-open';
export { trainingRepertoires } from './assignments/player-training';
export {
  markSeen,
  pauseAssignment,
  type PauseRequest,
  type SeenRequest,
} from './assignments/player-state';
export { auditEmailHash } from './audit-email';
export {
  claimBroadcastMonth,
  failBroadcastMonth,
  broadcastMonthStatuses,
  releaseInterruptedBroadcastMonths,
  writeBroadcastMonth,
  type BroadcastMonthClaim,
  type BroadcastMonthEntry,
  type BroadcastMonthWrite,
} from './broadcasts';
export {
  type BroadcastGameSource,
  type BroadcastGameStream,
  type BroadcastWriteCount,
  type BroadcastWriteOptions,
} from './broadcast-game-store';
export {
  FOUND_GAMES_LIMIT,
  gamesForFideId,
  type BroadcastSearchScope,
  type FoundGame,
  type FoundGames,
} from './broadcast-search';
export {
  broadcastTourStatuses,
  claimBroadcastTour,
  failBroadcastTour,
  queueBroadcastTour,
  releaseInterruptedBroadcastTours,
  writeBroadcastTour,
  type BroadcastTourClaim,
  type BroadcastTourEntry,
  type BroadcastTourWrite,
} from './broadcast-tours';
export {
  pruneBroadcastIndex,
  type BroadcastPruneCount,
} from './broadcast-prune';

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
  type CreatedGroup,
  type GroupAssignment,
  type GroupMember,
  type Membership,
} from './groups';
export {
  acceptInvite,
  coachInvites,
  createInvite,
  openGroupInvite,
  previewInvite,
  revokeInvite,
  type AcceptedInvite,
  type CoachInvite,
  type CreatedInvite,
  type InvitePreview,
  type InviteRequest,
  type OpenGroupInvite,
} from './invites';

export {
  listPersonalNotes,
  setAssignedPersonalNote,
  setPersonalNote,
  type PersonalNoteInput,
} from './personal-notes';
export type { CoachStatus } from './assignments/badges';
export {
  coachPlayerProgress,
  coachRepertoireProgress,
  type GroupProgress,
  type GroupColumn,
  type GroupProgressCell,
  type GroupProgressRow,
  type PlayerProgress,
  type ProgressRow,
  type RepertoireProgressRequest,
  type RepertoireProgressView,
} from './progress/coach-progress';
export {
  coachAssigneeStandings,
  type AssigneeStanding,
  type AssigneeStandingsRequest,
} from './progress/assignee-standings';
export { coachDashboard, type DashboardPlayer } from './progress/dashboard';
export { coachGroupPage, type GroupPage } from './progress/pages';
export type { ProgressView, RepertoireRef } from './progress/view';
export {
  countRateLimited,
  countWeighted,
  pruneRateLimits,
} from './rate-limits';
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
  mayAddRepertoire,
  renameRepertoire,
  type LoadedRepertoire,
  type NewRepertoire,
  type RepertoireListItem,
  type RepertoireRename,
} from './repertoires/repository';
export {
  setShares,
  shareRepertoire,
  sharedCoachIds,
  sharedRepertoireForCoach,
  unshareRepertoire,
  type SharedRepertoire,
  type ShareRequest,
  type SharesRequest,
  type SharesSet,
  type ShareTarget,
} from './shares';
export {
  trainingEntries,
  type TrainingRepertoireEntry,
} from './training/entries';
export { type TrainingExport } from './training/export';
export { knowCounts, learnAgain, markKnown } from './training/know';
export {
  learnedBetween,
  reviewsOf,
  trackedKeys,
  type StoredReview,
} from './training/reviews';
export { recordResults } from './training/results';
export { setTrainingSettings, trainingSettings } from './training/settings';
export {
  trainingSnapshot,
  type OtherTrainingRepertoire,
  type TrainingScope,
  type TrainingSnapshot,
} from './training/snapshot';

/** Better Auth's tables, keyed by the model names auth.ts maps them to. */
export const authSchema = {
  accounts,
  sessions,
  providerAccounts,
  verifications,
  rateLimits,
};
