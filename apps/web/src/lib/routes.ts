/**
 * The app's pages by what they are for. The paths themselves are Next's
 * file-system routes under `src/app`; this is the one place code names them.
 */
export const ROUTES = {
  home: '/',
  signIn: '/prisijungti',
  onboarding: '/pradzia',
  settings: '/nustatymai',
  repertoires: '/repertuarai',
  repertoireImport: '/repertuarai/importuoti',
  coach: '/treneris',
  /** The training page (S6 plan decision 9); trainingPath builds its links. */
  training: '/treniruote',
  /** The "Mano treneriai" section of settings (plan decision 12). */
  myCoaches: '/nustatymai#treneriai',
} as const;

/** An invite link's page; the token is one path segment. */
export const invitePath = (token: string): string =>
  `/k/${encodeURIComponent(token)}`;

/** One linked player's page in the coach dashboard. */
export const coachPlayerPath = (playerId: string): string =>
  `${ROUTES.coach}/zaidejai/${encodeURIComponent(playerId)}`;

/** A player's repertoire shared with the coach, in the coach dashboard. */
export const coachSharedRepertoirePath = (
  playerId: string,
  repertoireId: string,
): string =>
  `${coachPlayerPath(playerId)}/repertuarai/${encodeURIComponent(repertoireId)}`;

/** One group's page in the coach dashboard. */
export const coachGroupPath = (groupId: string): string =>
  `${ROUTES.coach}/grupes/${encodeURIComponent(groupId)}`;

/** One repertoire's page (browse and builder). */
export const repertoireRoute = (id: string): string =>
  `${ROUTES.repertoires}/${id}`;

/** A repertoire the player has by assignment, as they see it (decision 11). */
export const assignedRepertoirePath = (id: string): string =>
  `${ROUTES.repertoires}/priskirti/${encodeURIComponent(id)}`;

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

/** What a training session does: drill due Reviews or learn new Moves. */
export type TrainingMode = 'review' | 'learn';

/** The training page; `repertoireId` scopes it to one repertoire (R-142). */
export const trainingPath = (
  mode: TrainingMode,
  repertoireId?: string,
): string =>
  `${ROUTES.training}?mode=${mode}${repertoireId === undefined ? '' : `&r=${encodeURIComponent(repertoireId)}`}`;

/** Where the browser posts its queued training results. */
export const trainingResultsRoute = '/api/training/results';

/** Mano repertuarai after a delete: its status line says so. */
export const repertoireDeletedRoute = `${ROUTES.repertoires}?deleted=1`;
