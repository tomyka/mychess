// The PGN import's use cases (R-64, R-66, R-101), shared by the preview and
// the confirm action. Both re-import the uploaded text, so every R-66 limit
// is checked on the server whatever the browser did, and the confirm never
// trusts a preview. The preview of adding to a repertoire reads it through
// ownRepertoire (the domain's access rule, enforced again by the owner
// filter in the query) and merges in memory. The confirm decides in
// editRepertoire under the row lock: owner, then the version the preview
// showed (decision 6), then the merge, refused when nothing in the file can
// be added (R-115). An account runs at most ten previews or confirms a
// minute between them (R-119), counted before the text is read; the file is
// parsed and checked against its limits (R-66) before the lock is taken.
import {
  importPgn,
  mergeInto,
  SIDES,
  summarize,
  type ImportedRepertoire,
  type LimitRefusal,
  type MergedRepertoire,
  type NothingToAdd,
  type RepertoireGraph,
  type RepertoireSummary,
  type Skipped,
} from '@mychess/chess';
import {
  countRateLimited,
  createRepertoire,
  editRepertoire,
  type LoadedRepertoire,
} from '@mychess/db';
import {
  IMPORT_RATE_LIMIT,
  importRateKey,
  REPERTOIRE_ISSUES,
  REPERTOIRE_REFUSALS,
  repertoireNameSchema,
  type Account,
  type Locale,
  type RateRefusal,
} from '@mychess/domain';
import { z } from 'zod';
import { chapterLabelIn } from './chapter-names';
import { getDb } from './db';
import { refusalOf } from './parse-refusal';
import { ownRepertoire } from './repertoires';

/** The existing repertoire a preview was merged into. */
export interface ImportTarget {
  readonly id: string;
  readonly name: string;
  /** The version the merge was computed from; the confirm sends it back. */
  readonly version: number;
  /** What the merge adds to it. */
  readonly added: { readonly chapters: number; readonly moves: number };
}

/** An existing chapter whose title a merge changes (R-159). */
export interface RenamedChapter {
  readonly from: string;
  readonly to: string;
}

/** What the import summary shows before the player confirms (R-64). */
export interface ImportPreview {
  readonly summary: RepertoireSummary;
  /**
   * The titles of the chapters the upload brings, in order, as the
   * repertoire page will show them after the import (R-158).
   */
  readonly chapters: readonly string[];
  /**
   * The target's chapters whose title the merge changes, because a chapter
   * of the same name joins them (R-158, R-159); empty for a new repertoire.
   */
  readonly renamed: readonly RenamedChapter[];
  readonly skipped: readonly Skipped[];
  readonly target: ImportTarget | null;
  /** Why Import is refused for this target (R-115), or null. */
  readonly refusal: NothingToAdd['reason'] | null;
}

const PGN_UNREADABLE = 'pgn.unreadable';

/** Every refusal an import can come to; each is a message-catalogue key. */
export type ImportRefusalKey =
  | LimitRefusal['reason']
  | typeof IMPORT_RATE_LIMIT.reason
  | 'pgn.noValidGames'
  | NothingToAdd['reason']
  | typeof PGN_UNREADABLE
  | 'repertoire.sideMismatch'
  | (typeof REPERTOIRE_REFUSALS)[keyof typeof REPERTOIRE_REFUSALS]
  | typeof REPERTOIRE_ISSUES.nameBlank
  | typeof REPERTOIRE_ISSUES.nameTooLong
  | typeof REPERTOIRE_ISSUES.sideInvalid;

/** A limit an import breaks: the file's (R-66) or the imports a minute (R-119). */
type LimitKey = LimitRefusal['reason'] | typeof IMPORT_RATE_LIMIT.reason;

/** A refusal that names no limit. */
type PlainKey = Exclude<ImportRefusalKey, LimitKey>;

/**
 * Why an import is refused, in the shape the domain gives it: a key, and
 * the limit broken when it is a limit (bytes, games, depth or half-moves,
 * R-66, R-119; or the imports a minute, R-119).
 */
type ImportRefusal =
  | LimitRefusal
  | RateRefusal<typeof IMPORT_RATE_LIMIT.reason>
  | { readonly reason: PlainKey };

export interface ImportRefused {
  readonly ok: false;
  readonly refusal: ImportRefusal;
}

export type PreviewOutcome =
  { readonly ok: true; readonly preview: ImportPreview } | ImportRefused;

/** An import done: the repertoire, and the first chapter it brought. */
interface Imported {
  readonly ok: true;
  readonly id: string;
  readonly chapterId: string | null;
}

export type ConfirmOutcome = Imported | ImportRefused;

const REQUEST_KEYS: readonly PlainKey[] = [
  PGN_UNREADABLE,
  REPERTOIRE_ISSUES.nameBlank,
  REPERTOIRE_ISSUES.nameTooLong,
  REPERTOIRE_ISSUES.sideInvalid,
  REPERTOIRE_REFUSALS.stale,
];

const fileFields = {
  text: z.string(PGN_UNREADABLE),
  side: z.enum(SIDES, REPERTOIRE_ISSUES.sideInvalid),
};

const repertoireId = z.uuid(REPERTOIRE_REFUSALS.notFound);

const previewRequestSchema = z.object({
  ...fileFields,
  into: repertoireId.optional(),
});

const confirmRequestSchema = z.object({
  ...fileFields,
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('new'), name: repertoireNameSchema }),
    z.object({
      kind: z.literal('existing'),
      id: repertoireId,
      version: z
        .number(REPERTOIRE_REFUSALS.stale)
        .int(REPERTOIRE_REFUSALS.stale)
        .positive(REPERTOIRE_REFUSALS.stale),
    }),
  ]),
});

type ExistingTarget = Extract<
  z.infer<typeof confirmRequestSchema>['target'],
  { kind: 'existing' }
>;

const refused = (refusal: ImportRefusal): ImportRefused => ({
  ok: false,
  refusal,
});

/** A malformed request's refusal: its first known issue, else not found. */
const requestRefused = (error: z.ZodError): ImportRefused =>
  refused({
    reason: refusalOf(error, REQUEST_KEYS, REPERTOIRE_REFUSALS.notFound),
  });

/** Counts one preview or confirm of `account`; refused over the R-119 limit. */
async function withinRateLimit(
  account: Account,
  now: Date,
): Promise<ImportRefused | null> {
  const counted = await countRateLimited(
    getDb(),
    importRateKey(account.id),
    IMPORT_RATE_LIMIT,
    now,
  );
  return counted.ok ? null : refused(counted.refusal);
}

type ImportedFile =
  { readonly ok: true; readonly value: ImportedRepertoire } | ImportRefused;

/** The uploaded text imported for `side`, or the R-66 / R-64 refusal. */
function importFile(file: z.infer<typeof previewRequestSchema>): ImportedFile {
  const imported = importPgn(file.text, file.side);
  return imported.ok ? imported : refused(imported.refusal);
}

/**
 * The titles of `graph`'s chapters from the `from`th on, in `locale`: each
 * as the repertoire page will name it once `graph` is saved, told apart
 * from any chapter of the same name (R-158).
 */
const titlesFrom = (
  graph: RepertoireGraph,
  from: number,
  locale: Locale,
): string[] => graph.chapters.slice(from).map(chapterLabelIn(graph, locale));

/**
 * `before`'s chapters whose title, in `locale`, differs in `after`, the
 * repertoire a merge made of it (R-159): each with its old and new title.
 */
function renamedBy(
  before: RepertoireGraph,
  after: RepertoireGraph,
  locale: Locale,
): RenamedChapter[] {
  const was = chapterLabelIn(before, locale);
  const becomes = chapterLabelIn(after, locale);
  return before.chapters
    .map((chapter) => ({ from: was(chapter), to: becomes(chapter) }))
    .filter(({ from, to }) => from !== to);
}

/** A new repertoire's preview: the import as it stands. */
function newPreview(
  imported: ImportedRepertoire,
  locale: Locale,
): ImportPreview {
  return {
    summary: summarize(imported.graph),
    chapters: titlesFrom(imported.graph, 0, locale),
    renamed: [],
    skipped: imported.skipped,
    target: null,
    refusal: null,
  };
}

/** The preview of adding `imported` to `loaded`: the merged repertoire. */
function mergedPreview(
  loaded: LoadedRepertoire,
  imported: ImportedRepertoire,
  merged: MergedRepertoire,
  locale: Locale,
): ImportPreview {
  const before = loaded.graph;
  const after = merged.graph;
  const { id, name, version } = loaded.repertoire;
  const addition = merged.added;
  return {
    summary: summarize(after),
    chapters: titlesFrom(after, before.chapters.length, locale),
    renamed: renamedBy(before, after, locale),
    skipped: [...imported.skipped, ...merged.skipped].sort(
      (a, b) => a.game - b.game,
    ),
    target: {
      id,
      name,
      version,
      added: addition.ok
        ? { chapters: addition.value.chapters, moves: addition.value.moves }
        : { chapters: 0, moves: 0 },
    },
    refusal: addition.ok ? null : addition.refusal.reason,
  };
}

type Merged =
  | {
      readonly ok: true;
      readonly loaded: LoadedRepertoire;
      readonly merged: MergedRepertoire;
    }
  | ImportRefused;

/**
 * The preview's merge: `imported` merged in memory into the account's
 * repertoire `id`, which it may edit. Nothing is saved; the confirm decides
 * again in editRepertoire.
 */
async function mergeIntoOwn(
  account: Account,
  id: string,
  imported: ImportedRepertoire,
): Promise<Merged> {
  const own = await ownRepertoire(account, id, 'edit');
  if (!own.ok) return refused(own.refusal);
  const merged = mergeInto(own.value.graph, imported);
  if (!merged.ok) return refused(merged.refusal);
  return { ok: true, loaded: own.value, merged: merged.value };
}

/**
 * What an upload would import (R-64): into a new repertoire, or (`into`)
 * merged into one of the account's repertoires of the same side (R-101).
 */
export async function previewImport(
  account: Account,
  input: unknown,
  now: Date,
): Promise<PreviewOutcome> {
  const limited = await withinRateLimit(account, now);
  if (limited !== null) return limited;
  const request = previewRequestSchema.safeParse(input);
  if (!request.success) return requestRefused(request.error);
  const imported = importFile(request.data);
  if (!imported.ok) return imported;
  const { into } = request.data;
  if (into === undefined) {
    return { ok: true, preview: newPreview(imported.value, account.locale) };
  }
  const merge = await mergeIntoOwn(account, into, imported.value);
  if (!merge.ok) return merge;
  const { loaded, merged } = merge;
  return {
    ok: true,
    preview: mergedPreview(loaded, imported.value, merged, account.locale),
  };
}

/**
 * Adds `imported` to an existing repertoire. editRepertoire decides and
 * saves it under the row lock: not found, then stale (changed since the
 * preview), then the merge's refusal (the other side, or nothing to add,
 * R-115); nothing is written on any refusal.
 */
async function importInto(
  account: Account,
  target: ExistingTarget,
  imported: ImportedRepertoire,
  now: Date,
): Promise<ConfirmOutcome> {
  const edited = await editRepertoire(getDb(), {
    id: target.id,
    viewer: account,
    expectedVersion: target.version,
    change: { kind: 'import', imported },
    now,
  });
  if (!edited.ok) return refused(edited.refusal);
  return { ok: true, id: target.id, chapterId: edited.value.firstChapterId };
}

/**
 * Imports the upload for good: a new repertoire with the given name, or the
 * games added to an existing one. The text is imported again here.
 */
export async function confirmImport(
  account: Account,
  input: unknown,
  now: Date,
): Promise<ConfirmOutcome> {
  const limited = await withinRateLimit(account, now);
  if (limited !== null) return limited;
  const request = confirmRequestSchema.safeParse(input);
  if (!request.success) return requestRefused(request.error);
  const imported = importFile(request.data);
  if (!imported.ok) return imported;
  const { side, target } = request.data;
  if (target.kind === 'existing') {
    return importInto(account, target, imported.value, now);
  }
  const id = await createRepertoire(getDb(), {
    ownerId: account.id,
    side,
    name: target.name,
    graph: imported.value.graph,
    now,
  });
  return {
    ok: true,
    id,
    chapterId: imported.value.graph.chapters[0]?.id ?? null,
  };
}
