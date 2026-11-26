/**
 * The app's pages by what they are for. The paths themselves are Next's
 * file-system routes under `src/app`; this is the one place code names them.
 */
import type { LearnFocus, TrainingMode } from '@mychess/chess';

/** The id of settings' training section, which ROUTES.trainingSettings opens. */
export const TRAINING_SETTINGS_SECTION = 'training';

export const ROUTES = {
  home: '/',
  signIn: '/sign-in',
  onboarding: '/welcome',
  settings: '/settings',
  repertoires: '/repertoires',
  repertoireImport: '/repertoires/import',
  coach: '/coach',
  /** The training page (S6 plan decision 9); trainingPath builds its links. */
  training: '/training',
  /** The FIDE ID search (#316); the ID is posted, never in the URL. */
  fideSearch: '/fide',
  /** The "My coaches" section of settings (plan decision 12). */
  myCoaches: '/settings#coaches',
  /** The training section of settings: the limits and the arrows (R-205). */
  trainingSettings: `/settings#${TRAINING_SETTINGS_SECTION}`,
} as const;

/** An invite link's page; the token is one path segment. */
export const invitePath = (token: string): string =>
  `/invite/${encodeURIComponent(token)}`;

/**
 * "My coaches" after accepting an invite: it names the coach just
 * linked, by id, so the section can say so (#329). The page shows the name
 * only for a coach the session account is linked to.
 */
export const acceptedInvitePath = (coachId: string): string =>
  `${ROUTES.settings}?coach=${encodeURIComponent(coachId)}#coaches`;

/** One linked player's page in the coach dashboard. */
export const coachPlayerPath = (playerId: string): string =>
  `${ROUTES.coach}/players/${encodeURIComponent(playerId)}`;

/** A player's repertoire shared with the coach, in the coach dashboard. */
export const coachSharedRepertoirePath = (
  playerId: string,
  repertoireId: string,
): string =>
  `${coachPlayerPath(playerId)}/repertoires/${encodeURIComponent(repertoireId)}`;

/** A player's progress on one repertoire, in the coach dashboard (R-152). */
export const coachProgressPath = (
  playerId: string,
  repertoireId: string,
): string =>
  `${coachPlayerPath(playerId)}/progress/${encodeURIComponent(repertoireId)}`;

/** One group's page in the coach dashboard. */
export const coachGroupPath = (groupId: string): string =>
  `${ROUTES.coach}/groups/${encodeURIComponent(groupId)}`;

/** One repertoire's page (browse and builder). */
export const repertoireRoute = (id: string): string =>
  `${ROUTES.repertoires}/${id}`;

/** A repertoire the player has by assignment, as they see it (decision 11). */
export const assignedRepertoirePath = (id: string): string =>
  `${ROUTES.repertoires}/assigned/${encodeURIComponent(id)}`;

/** The repertoire's own actions, its Repertoire screen (R-226). */
export const repertoireManageRoute = (id: string): string =>
  `${repertoireRoute(id)}/manage`;

/** An assigned repertoire's actions, its Repertoire screen (R-226). */
export const assignedManageRoute = (id: string): string =>
  `${assignedRepertoirePath(id)}/manage`;

/**
 * The query parameter the assigned Repertoire screen opens "make my own
 * copy"'s question by (`?fork=1`).
 */
export const FORK_PARAM = 'fork';

/** The assigned Repertoire screen with "make my own copy"'s question open. */
export const assignedForkRoute = (id: string): string =>
  `${assignedManageRoute(id)}?${FORK_PARAM}=1`;

/** The query parameter a repertoire's page opens on a chapter by. */
export const CHAPTER_PARAM = 'chapter';

/** One repertoire's page, opened on one of its chapters. */
export const repertoireChapterRoute = (id: string, chapterId: string): string =>
  `${repertoireRoute(id)}?${CHAPTER_PARAM}=${encodeURIComponent(chapterId)}`;

/** One repertoire's PGN download. */
export const repertoireExportRoute = (id: string): string =>
  `/api/repertoires/${id}/export`;

/** The import page with an existing repertoire chosen as the target. */
export const importIntoRoute = (id: string): string =>
  `${ROUTES.repertoireImport}?i=${encodeURIComponent(id)}`;

/** The training page; `repertoireId` scopes it to one repertoire (R-142). */
export const trainingPath = (
  mode: TrainingMode,
  repertoireId?: string,
): string =>
  `${ROUTES.training}?mode=${mode}${repertoireId === undefined ? '' : `&r=${encodeURIComponent(repertoireId)}`}`;

/** The query parameter the training page learns one line of a chapter by. */
export const LINE_PARAM = 'line';

/** The learn pass over one chapter of a repertoire, or one line of it (R-206). */
export const learnPath = (
  repertoireId: string,
  focus: Omit<LearnFocus, 'repertoireId'>,
): string => {
  const line =
    focus.lineIndex === undefined
      ? ''
      : `&${LINE_PARAM}=${String(focus.lineIndex)}`;
  return `${trainingPath('learn', repertoireId)}&${CHAPTER_PARAM}=${encodeURIComponent(focus.chapterId)}${line}`;
};

/** Where the browser posts its queued training results. */
export const trainingResultsRoute = '/api/training/results';

/** My repertoires after a delete: its status line says so. */
export const repertoireDeletedRoute = `${ROUTES.repertoires}?deleted=1`;
