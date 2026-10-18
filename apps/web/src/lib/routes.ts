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
} as const;

/** One repertoire's page (browse and builder). */
export const repertoireRoute = (id: string): string =>
  `${ROUTES.repertoires}/${id}`;

/** One repertoire's PGN download. */
export const repertoireExportRoute = (id: string): string =>
  `/api/repertoires/${id}/export`;

/** The import page with an existing repertoire chosen as the target. */
export const importIntoRoute = (id: string): string =>
  `${ROUTES.repertoireImport}?i=${encodeURIComponent(id)}`;
