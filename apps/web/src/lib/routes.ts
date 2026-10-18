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
  /** The "Mano treneriai" section of settings (plan decision 12). */
  myCoaches: '/nustatymai#treneriai',
} as const;

/** An invite link's page; the token is one path segment. */
export const invitePath = (token: string): string =>
  `/k/${encodeURIComponent(token)}`;

/** One linked player's page in the coach dashboard. */
export const coachPlayerPath = (playerId: string): string =>
  `${ROUTES.coach}/zaidejai/${encodeURIComponent(playerId)}`;

/** One group's page in the coach dashboard. */
export const coachGroupPath = (groupId: string): string =>
  `${ROUTES.coach}/grupes/${encodeURIComponent(groupId)}`;

/** One repertoire's page (browse and builder). */
export const repertoireRoute = (id: string): string =>
  `${ROUTES.repertoires}/${id}`;

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

/** Mano repertuarai after a delete: its status line says so. */
export const repertoireDeletedRoute = `${ROUTES.repertoires}?deleted=1`;
