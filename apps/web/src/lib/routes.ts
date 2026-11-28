/**
 * The app's pages by what they are for. The paths themselves are Next's
 * file-system routes under `src/app`; this is the one place code names them.
 */
import type { LearnFocus, TrainingMode } from '@mychess/chess';
import { z } from 'zod';

/**
 * A page's query as Next hands it (`searchParams`). Each route that takes
 * one reads it with its own reader below, beside the link builder that
 * writes it (#402); a page never reads a raw param.
 */
export type SearchParams = Readonly<
  Record<string, string | string[] | undefined>
>;

/** A param given once; a repeated or missing one is absent. */
const single = z.string().optional().catch(undefined);

/**
 * A param's first value, repeated or not; absent when missing. For the
 * params whose pages always took the first (sign-in, welcome, Settings).
 */
export const firstValue = z
  .union([
    z.string(),
    z
      .array(z.string())
      .nonempty()
      .transform(([value]) => value),
  ])
  .optional()
  .catch(undefined);

/** A flag a link sets as `=1`: on only for that single value. */
const flag = z
  .literal('1')
  .transform(() => true)
  .catch(false);

/** The id of settings' training section, which ROUTES.trainingSettings opens. */
export const TRAINING_SETTINGS_SECTION = 'training';

/** The id of settings' My coaches section, which ROUTES.myCoaches opens. */
export const MY_COACHES_SECTION = 'coaches';

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
  myCoaches: `/settings#${MY_COACHES_SECTION}`,
  /** The training section of settings: the limits and the arrows (R-205). */
  trainingSettings: `/settings#${TRAINING_SETTINGS_SECTION}`,
} as const;

/** An invite link's page; the token is one path segment. */
export const invitePath = (token: string): string =>
  `/invite/${encodeURIComponent(token)}`;

/**
 * The names of the params accepting an invite lands on Today with (R-234):
 * the coach's id and, for a group invite, the group's. Today reads them
 * and the notice takes them out of the address once shown.
 */
export const LINKED_PARAMS = { coach: 'linked', group: 'group' } as const;

/**
 * Today after accepting an invite, with whom (R-234): the coach and, for a
 * group invite, the group, by id. Today names them only for a coach the
 * session account is linked to, never from the URL.
 */
export const acceptedInvitePath = (
  coachId: string,
  groupId: string | null,
): string => {
  const query = new URLSearchParams({ [LINKED_PARAMS.coach]: coachId });
  if (groupId !== null) query.set(LINKED_PARAMS.group, groupId);
  return `${ROUTES.home}?${query.toString()}`;
};

/** What Today reads of acceptedInvitePath's query: untrusted ids. */
export interface LinkedQuery {
  readonly coachId: string | undefined;
  readonly groupId: string | undefined;
}

/**
 * Today's query after accepting an invite: each id given once, or absent.
 * A repeated one is absent, so the address cannot pick among them; Today
 * still names a coach only from the player's own links.
 */
export const readLinkedQuery = (params: SearchParams): LinkedQuery => ({
  coachId: single.parse(params[LINKED_PARAMS.coach]),
  groupId: single.parse(params[LINKED_PARAMS.group]),
});

/**
 * The invite token of a return path to an invite, or null. The raw segment:
 * the caller parses it with `inviteTokenSchema`.
 */
export const inviteTokenOf = (path: string | null): string | null => {
  const match = /^\/invite\/([^/?#]+)$/u.exec(path ?? '');
  return match?.[1] ?? null;
};

/**
 * The main navigation's tabs by id. Which tabs an account has, their pages
 * and their order are shell/nav-tabs.ts's (#400).
 */
export type TabId = 'today' | 'repertoires' | 'opponents' | 'coach';

/** Settings' query parameters: the tab it came from, a provider's error. */
const SETTINGS_PARAMS = { from: 'from', error: 'error' } as const;

/** Settings, opened from the tab `from`, so its back link returns there. */
export const settingsPath = (from: TabId): string =>
  `${ROUTES.settings}?${SETTINGS_PARAMS.from}=${from}`;

/** Settings' My coaches section, opened from the tab `from`. */
export const myCoachesPath = (from: TabId): string =>
  `${settingsPath(from)}#${MY_COACHES_SECTION}`;

/**
 * Settings' query: the tab it was opened from (checked against the
 * account's tabs by shell/nav-tabs' settingsBack), and the reason a
 * provider link failed (Better Auth's `?error=`). The first of each.
 */
export const readSettingsQuery = (
  params: SearchParams,
): {
  readonly from: string | undefined;
  readonly error: string | undefined;
} => ({
  from: firstValue.parse(params[SETTINGS_PARAMS.from]),
  error: firstValue.parse(params[SETTINGS_PARAMS.error]),
});

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
  `${ROUTES.repertoires}/${encodeURIComponent(id)}`;

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
const FORK_PARAM = 'fork';

/** The assigned Repertoire screen with "make my own copy"'s question open. */
export const assignedForkRoute = (id: string): string =>
  `${assignedManageRoute(id)}?${FORK_PARAM}=1`;

/** The assigned Repertoire screen's query: whether the fork question opens. */
export const readAssignedManageQuery = (
  params: SearchParams,
): { readonly forkOpen: boolean } => ({
  forkOpen: flag.parse(params[FORK_PARAM]),
});

/** The query parameter a repertoire's page opens on a chapter by. */
const CHAPTER_PARAM = 'chapter';

/** A chapter id from a request: an edit's, or a page's `?chapter=`. */
export const chapterIdSchema = z.string().min(1).max(20);

/** One repertoire's page, opened on one of its chapters. */
export const repertoireChapterRoute = (id: string, chapterId: string): string =>
  `${repertoireRoute(id)}?${CHAPTER_PARAM}=${encodeURIComponent(chapterId)}`;

/**
 * A repertoire page's query: the chapter it opens on, a well-formed id
 * given once, else null (the first chapter opens).
 */
export const readRepertoireQuery = (
  params: SearchParams,
): { readonly chapterId: string | null } => {
  const chapter = chapterIdSchema.safeParse(params[CHAPTER_PARAM]);
  return { chapterId: chapter.success ? chapter.data : null };
};

/** One repertoire's PGN download. */
export const repertoireExportRoute = (id: string): string =>
  `/api/repertoires/${encodeURIComponent(id)}/export`;

/** The query parameter the import page names its opening repertoire by. */
const IMPORT_INTO_PARAM = 'i';

/** The import page with an existing repertoire chosen as the target. */
export const importIntoRoute = (id: string): string =>
  `${ROUTES.repertoireImport}?${IMPORT_INTO_PARAM}=${encodeURIComponent(id)}`;

/**
 * The import page's query: the repertoire it was opened from, given once.
 * Untrusted: the page counts it only among the account's own targets.
 */
export const readImportQuery = (
  params: SearchParams,
): { readonly into: string | undefined } => ({
  into: single.parse(params[IMPORT_INTO_PARAM]),
});

/** The training page; `repertoireId` scopes it to one repertoire (R-142). */
export const trainingPath = (
  mode: TrainingMode,
  repertoireId?: string,
): string =>
  `${ROUTES.training}?mode=${mode}${repertoireId === undefined ? '' : `&r=${encodeURIComponent(repertoireId)}`}`;

/** The query parameter the training page learns one line of a chapter by. */
const LINE_PARAM = 'line';

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

const trainingQuerySchema = z.object({
  mode: z.enum(['review', 'learn']).catch('review'),
  r: z.uuid().optional().catch(undefined),
  /** A chapter id, as the repertoire page's `?chapter=` takes one. */
  [CHAPTER_PARAM]: chapterIdSchema.optional().catch(undefined),
  /** A line's index in its chapter: digits only. */
  [LINE_PARAM]: z
    .string()
    .regex(/^\d{1,4}$/)
    .transform(Number)
    .optional()
    .catch(undefined),
});

/**
 * Every repertoire the player trains, or the one `r=` names. Mirrors
 * @mychess/db's TrainingScope, copied because client components import
 * this module and must not pull in the db package.
 */
type TrainingQueryScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'repertoire'; readonly repertoireId: string };

/** The focus the URL names: learn only, in the scoped repertoire, with a chapter. */
function focusOf(
  mode: TrainingMode,
  repertoireId: string | undefined,
  chapterId: string | undefined,
  lineIndex: number | undefined,
): LearnFocus | null {
  if (mode !== 'learn' || repertoireId === undefined || chapterId === undefined)
    return null;
  return {
    repertoireId,
    chapterId,
    ...(lineIndex === undefined ? {} : { lineIndex }),
  };
}

/**
 * The training page's query, as trainingPath and learnPath write it
 * (R-142, R-206): an unknown mode is a review; a bad `r`, chapter or line
 * is dropped. The loader still checks the repertoire is one the player
 * trains.
 */
export function readTrainingQuery(params: SearchParams): {
  readonly mode: TrainingMode;
  readonly scope: TrainingQueryScope;
  readonly focus: LearnFocus | null;
} {
  const { mode, r, chapter, line } = trainingQuerySchema.parse(params);
  return {
    mode,
    scope:
      r === undefined
        ? { kind: 'all' }
        : { kind: 'repertoire', repertoireId: r },
    focus: focusOf(mode, r, chapter, line),
  };
}

/** Where the browser posts its queued training results. */
export const trainingResultsRoute = '/api/training/results';

/** The query parameter My repertoires says a delete happened by. */
const DELETED_PARAM = 'deleted';

/** My repertoires after a delete: its status line says so. */
export const repertoireDeletedRoute = `${ROUTES.repertoires}?${DELETED_PARAM}=1`;

/** My repertoires' query: whether it says a repertoire was deleted. */
export const readRepertoiresQuery = (
  params: SearchParams,
): { readonly deleted: boolean } => ({
  deleted: flag.parse(params[DELETED_PARAM]),
});
