// The PGN import's use cases (R-64, R-66, R-101), shared by the preview and
// the confirm action. Both re-import the uploaded text, so every R-66 limit
// is checked on the server whatever the browser did, and the confirm never
// trusts a preview. Adding to a repertoire goes through ownRepertoire (the
// domain's access rule, enforced again by the owner filter in the query),
// is refused when nothing in the file can be added (R-115), and is saved
// against the version the preview showed (decision 6). An account runs at
// most ten previews or confirms a minute between them (R-119), counted
// before the text is read.
import {
  chapterName,
  importPgn,
  mergeInto,
  SIDES,
  summarize,
  type Chapter,
  type ChapterName,
  type ImportedRepertoire,
  type Locale,
  type MergedRepertoire,
  type NothingToAdd,
  type RepertoireSummary,
  type Skipped,
} from '@mychess/chess';
import {
  countRateLimited,
  createRepertoire,
  saveRepertoireEdit,
  type LoadedRepertoire,
} from '@mychess/db';
import {
  IMPORT_RATE_LIMIT,
  importRateKey,
  REPERTOIRE_ISSUES,
  REPERTOIRE_REFUSALS,
  repertoireNameSchema,
  type Account,
} from '@mychess/domain';
import { z } from 'zod';
import { getDb } from './db';
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

/** What the import summary shows before the player confirms (R-64). */
export interface ImportPreview {
  readonly summary: RepertoireSummary;
  /** The chapters the upload brings, in order. */
  readonly chapters: readonly ChapterName[];
  readonly skipped: readonly Skipped[];
  readonly target: ImportTarget | null;
  /** Why Import is refused for this target (R-115), or null. */
  readonly refusal: NothingToAdd['reason'] | null;
}

const PGN_UNREADABLE = 'pgn.unreadable';

/** Every refusal an import can come to; each is a message-catalogue key. */
export type ImportRefusalKey =
  | 'pgn.tooLarge'
  | 'pgn.tooManyGames'
  | 'pgn.tooDeep'
  | 'pgn.tooManyMoves'
  | typeof IMPORT_RATE_LIMIT.reason
  | 'pgn.noValidGames'
  | NothingToAdd['reason']
  | typeof PGN_UNREADABLE
  | 'repertoire.sideMismatch'
  | (typeof REPERTOIRE_REFUSALS)[keyof typeof REPERTOIRE_REFUSALS]
  | typeof REPERTOIRE_ISSUES.nameBlank
  | typeof REPERTOIRE_ISSUES.nameTooLong
  | typeof REPERTOIRE_ISSUES.sideInvalid;

export interface ImportRefused {
  readonly ok: false;
  readonly refusal: ImportRefusalKey;
  /**
   * The limit broken: the file's (R-66, R-119: bytes, games, depth or
   * half-moves) or the imports a minute (R-119).
   */
  readonly limit?: number;
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

const REQUEST_KEYS: readonly ImportRefusalKey[] = [
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

const refused = (refusal: {
  readonly reason: ImportRefusalKey;
  readonly limit?: number;
}): ImportRefused =>
  refusal.limit === undefined
    ? { ok: false, refusal: refusal.reason }
    : { ok: false, refusal: refusal.reason, limit: refusal.limit };

/** A malformed request's refusal: its first known issue, else not found. */
function requestRefused(error: z.ZodError): ImportRefused {
  const message = error.issues[0]?.message;
  const reason =
    REQUEST_KEYS.find((key) => key === message) ?? REPERTOIRE_REFUSALS.notFound;
  return refused({ reason });
}

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

const namesOf = (chapters: readonly Chapter[], locale: Locale): ChapterName[] =>
  chapters.map((c) => chapterName(c.nameSource, locale));

/** A new repertoire's preview: the import as it stands. */
function newPreview(
  imported: ImportedRepertoire,
  locale: Locale,
): ImportPreview {
  return {
    summary: summarize(imported.graph),
    chapters: namesOf(imported.graph.chapters, locale),
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
    chapters: namesOf(after.chapters.slice(before.chapters.length), locale),
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

/** `imported` merged into the account's repertoire `id`, which it may edit. */
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

/** Adds `imported` to an existing repertoire, refused if it changed since the preview. */
async function importInto(
  account: Account,
  target: ExistingTarget,
  imported: ImportedRepertoire,
  now: Date,
): Promise<ConfirmOutcome> {
  const merge = await mergeIntoOwn(account, target.id, imported);
  if (!merge.ok) return merge;
  const addition = merge.merged.added;
  if (!addition.ok) return refused(addition.refusal);
  // The save bumps only the previewed version, in the same transaction it
  // writes in: a repertoire changed since the preview (or since the load
  // above) is refused as stale and nothing is written.
  const saved = await saveRepertoireEdit(getDb(), {
    id: merge.loaded.repertoire.id,
    ownerId: account.id,
    expectedVersion: target.version,
    after: merge.merged.graph,
    now,
  });
  if (!saved.ok) return refused(saved.refusal);
  return { ok: true, id: target.id, chapterId: addition.value.firstChapterId };
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
