import 'server-only';
// The PGN import's use cases (R-64, R-66, R-101), shared by the preview and
// the confirm action. Both re-import the uploaded text, so every R-66 limit
// is checked on the server whatever the browser did, and the confirm never
// trusts a preview. The preview of adding to a repertoire reads it through
// ownRepertoire (the domain's access rule, enforced again by the owner
// filter in the query) and merges in memory. The confirm decides in
// editRepertoire under the row lock: owner, then the version the preview
// showed (decision 6), then the merge, refused when nothing in the file can
// be added (R-115). An account runs at most thirty previews (R-208) and ten
// confirms (R-119) a minute, counted apart and before the text is read; the
// file is parsed and checked against its limits (R-66) before the lock is
// taken.
// The account's repertoire limits (R-162) refuse a new repertoire past 50
// and a graph past 5,000 moves: the preview asks the domain up front, and
// createRepertoire or editRepertoire decide again at the confirm.
import {
  annotatedSan,
  hasGlyph,
  importPgn,
  mergeInto,
  moveNumber,
  numberedMove,
  suggestedRepertoireName,
  suggestedSide as sideToSuggest,
  SIDES,
  summarize,
  type AddedAnnotation as MergedAnnotation,
  type ImportedRepertoire,
  type LimitRefusal,
  type MergedRepertoire,
  type NothingToAdd,
  type RepertoireGraph,
  type RepertoireSummary,
  type Side,
  type SkipReason,
  type Skipped,
} from '@mychess/chess';
import {
  countRateLimited,
  createRepertoire,
  editRepertoire,
  mayAddRepertoire,
  type LoadedRepertoire,
} from '@mychess/db';
import {
  canHoldMoves,
  IMPORT_PREVIEW_RATE_LIMIT,
  IMPORT_RATE_LIMIT,
  importPreviewRateKey,
  importRateKey,
  REPERTOIRE_ISSUES,
  REPERTOIRE_NAME_MAX,
  REPERTOIRE_REFUSALS,
  repertoireNameSchema,
  type Account,
  type RateRefusal,
  type RateRule,
  type RepertoireLimitRefusal,
} from '@mychess/domain';
import { z } from 'zod';
import { chapterLabelOf } from './chapter-names';
import { getDb } from './db';
import { refusalOf } from './parse-refusal';
import { ownRepertoire } from './repertoires';

/** The existing repertoire a preview was merged into. */
export interface ImportTarget {
  readonly id: string;
  readonly name: string;
  /** The version the merge was computed from; the confirm sends it back. */
  readonly version: number;
  /**
   * What the merge adds to it: chapters, moves, and the moves already
   * there that gain a comment or NAGs (R-176).
   */
  readonly added: {
    readonly chapters: number;
    readonly moves: number;
    /** The moves listed in `annotations`: those whose addition shows. */
    readonly annotated: number;
  };
}

/**
 * An Annotation (a comment, NAGs or both) a merge adds to a move the target
 * already has (R-176): the move as players read it ("8. Qxc4!", with the
 * glyphs of the NAGs it gains, R-175), and the comment it gains or null.
 */
export interface AddedAnnotation {
  readonly move: string;
  readonly comment: string | null;
}

/**
 * A game the import left out, or the part of it below a second answer
 * (R-54, R-64), as the summary lists it.
 */
export interface SkippedGame {
  /** The game's 1-based position among the file's games. */
  readonly game: number;
  readonly reason: SkipReason;
  /**
   * The move at fault as players read it: a second answer numbered ("5...a6",
   * "2. Bf4"), any other move as the file wrote it ("Nxe4"); null for none.
   */
  readonly moveText: string | null;
}

/** An existing chapter whose title a merge changes (R-159). */
export interface RenamedChapter {
  readonly from: string;
  readonly to: string;
}

/** What the import summary shows before the player confirms (R-64). */
export interface ImportPreview {
  /** What the file holds, alone: for a merge too, not the merged repertoire. */
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
  readonly skipped: readonly SkippedGame[];
  /**
   * The comments and NAGs a merge adds that show (R-175, R-176); empty for
   * a new repertoire.
   */
  readonly annotations: readonly AddedAnnotation[];
  readonly target: ImportTarget | null;
  /** Why Import is refused for this target (R-115), or null. */
  readonly refusal: NothingToAdd['reason'] | null;
  /**
   * The side the file looks like a repertoire for, when it is not the one
   * chosen (#364, R-214): most games lost second answers, and fewer would
   * as that side. Null when the chosen side fits.
   */
  readonly suggestedSide: Side | null;
  /**
   * The name a new repertoire is suggested: the Event tag every game
   * shares, else the file's name without its extension, else ''.
   */
  readonly suggestedName: string;
}

const PGN_UNREADABLE = 'pgn.unreadable';

/** The previews (R-208) or the confirms (R-119) a minute, refused. */
type RateKey =
  typeof IMPORT_PREVIEW_RATE_LIMIT.reason | typeof IMPORT_RATE_LIMIT.reason;

/** Every refusal an import can come to; each is a message-catalogue key. */
export type ImportRefusalKey =
  | LimitRefusal['reason']
  | RateKey
  | 'pgn.noValidGames'
  | NothingToAdd['reason']
  | typeof PGN_UNREADABLE
  | 'repertoire.sideMismatch'
  | (typeof REPERTOIRE_REFUSALS)[keyof typeof REPERTOIRE_REFUSALS]
  | typeof REPERTOIRE_ISSUES.nameBlank
  | typeof REPERTOIRE_ISSUES.nameTooLong
  | typeof REPERTOIRE_ISSUES.sideInvalid;

/**
 * A limit an import breaks: the file's (R-66), the previews or confirms a
 * minute (R-208, R-119) or the account's repertoires (R-162).
 */
type LimitKey =
  LimitRefusal['reason'] | RateKey | RepertoireLimitRefusal['reason'];

/** A refusal that names no limit. */
type PlainKey = Exclude<ImportRefusalKey, LimitKey>;

/**
 * Why an import is refused, in the shape the domain gives it: a key, and
 * the limit broken when it is a limit (bytes, games, depth or half-moves,
 * R-66, R-119; the previews or confirms a minute, R-208, R-119; or
 * repertoires or moves, R-162).
 */
type ImportRefusal =
  | LimitRefusal
  | RateRefusal<RateKey>
  | RepertoireLimitRefusal
  | { readonly reason: PlainKey };

export interface ImportRefused {
  readonly ok: false;
  readonly refusal: ImportRefusal;
}

export type PreviewOutcome =
  { readonly ok: true; readonly preview: ImportPreview } | ImportRefused;

/**
 * A preview before the side check and the suggested name: what the import
 * and merge give.
 */
type PreviewBody = Omit<ImportPreview, 'suggestedSide' | 'suggestedName'>;

type BodyOutcome =
  { readonly ok: true; readonly preview: PreviewBody } | ImportRefused;

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
  /** The file's name, to suggest the repertoire's from; none for pasted text. */
  fileName: z.string().optional().catch(undefined),
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

/** What a confirm request sends, before the server parses it. */
export type ConfirmRequestInput = z.input<typeof confirmRequestSchema>;

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

/** A preview's or a confirm's counter: apart, as R-208 limits them apart. */
interface ImportCounter {
  readonly rule: RateRule<RateKey>;
  readonly key: (accountId: string) => string;
}

const PREVIEWS: ImportCounter = {
  rule: IMPORT_PREVIEW_RATE_LIMIT,
  key: importPreviewRateKey,
};
const CONFIRMS: ImportCounter = {
  rule: IMPORT_RATE_LIMIT,
  key: importRateKey,
};

/**
 * Counts one preview (R-208) or confirm (R-119) of `account` on its own
 * counter; refused over that counter's limit.
 */
async function withinRateLimit(
  account: Account,
  counter: ImportCounter,
  now: Date,
): Promise<ImportRefused | null> {
  const counted = await countRateLimited(
    getDb(),
    counter.key(account.id),
    counter.rule,
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
 * The titles of `graph`'s chapters from the `from`th on: each
 * as the repertoire page will name it once `graph` is saved, told apart
 * from any chapter of the same name (R-158).
 */
const titlesFrom = (graph: RepertoireGraph, from: number): string[] =>
  graph.chapters.slice(from).map(chapterLabelOf(graph));

/**
 * `before`'s chapters whose title differs in `after`, the
 * repertoire a merge made of it (R-159): each with its old and new title.
 */
function renamedBy(
  before: RepertoireGraph,
  after: RepertoireGraph,
): RenamedChapter[] {
  const was = chapterLabelOf(before);
  const becomes = chapterLabelOf(after);
  return before.chapters
    .map((chapter) => ({ from: was(chapter), to: becomes(chapter) }))
    .filter(({ from, to }) => from !== to);
}

/**
 * The move a skip names as players read it: a second answer of `side` with
 * its full-move number ("5...a6" for Black, "2. Bf4" for White), any other
 * as the file wrote it, or null.
 */
function skippedMove(skipped: Skipped, side: Side): string | null {
  return skipped.reason === 'pgn.secondAnswer'
    ? numberedMove(skipped.move, side, skipped.san)
    : (skipped.san ?? null);
}

/** `skipped` as the summary lists it, in game order, each move numbered. */
const listedSkips = (skipped: readonly Skipped[], side: Side): SkippedGame[] =>
  [...skipped]
    .sort((a, b) => a.game - b.game)
    .map((item) => ({
      game: item.game,
      reason: item.reason,
      moveText: skippedMove(item, side),
    }));

/** A new repertoire's preview: the import as it stands. */
function newPreview(imported: ImportedRepertoire): PreviewBody {
  return {
    summary: summarize(imported.graph),
    chapters: titlesFrom(imported.graph, 0),
    renamed: [],
    skipped: listedSkips(imported.skipped, imported.graph.side),
    annotations: [],
    target: null,
    refusal: null,
  };
}

/**
 * The added annotations the preview lists: each that shows something, a
 * comment or a NAG's glyph (R-175). A move gaining only glyph-less NAGs
 * ($146) would read as nothing new, so it is left out of the list and of
 * the target's `annotated` count; the file still adds it, so the merge does
 * not refuse it as nothing to add (R-115).
 */
function listedAnnotations(
  added: readonly MergedAnnotation[],
): AddedAnnotation[] {
  return added.flatMap(({ ply, san, nags, comment }) => {
    if (comment === null && !hasGlyph(nags)) return [];
    const move = `${moveNumber(ply, true)} ${annotatedSan(san, nags)}`;
    return [{ move, comment }];
  });
}

/**
 * The preview of adding `imported` to `loaded`: what the file holds, and
 * the chapters, renames and annotations the merge brings.
 */
function mergedPreview(
  loaded: LoadedRepertoire,
  imported: ImportedRepertoire,
  merged: MergedRepertoire,
): PreviewBody {
  const before = loaded.graph;
  const after = merged.graph;
  const { id, name, version } = loaded.repertoire;
  const addition = merged.added;
  const annotations = listedAnnotations(
    addition.ok ? addition.value.annotations : [],
  );
  return {
    summary: summarize(imported.graph),
    chapters: titlesFrom(after, before.chapters.length),
    renamed: renamedBy(before, after),
    skipped: listedSkips(
      [...imported.skipped, ...merged.skipped],
      imported.graph.side,
    ),
    annotations,
    target: {
      id,
      name,
      version,
      added: {
        chapters: addition.ok ? addition.value.chapters : 0,
        moves: addition.ok ? addition.value.moves : 0,
        annotated: annotations.length,
      },
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
 * repertoire `id`, which it may edit, refused when it would grow past the
 * R-162 move limit. Nothing is saved; the confirm decides again in
 * editRepertoire.
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
  const fits = canHoldMoves(account, {
    before: own.value.graph.moves.length,
    after: merged.value.graph.moves.length,
  });
  if (!fits.ok) return refused(fits.refusal);
  return { ok: true, loaded: own.value, merged: merged.value };
}

/**
 * A new repertoire's preview, refused up front when the account may not
 * add one or the import holds more moves than one may (R-162).
 */
async function previewNew(
  account: Account,
  imported: ImportedRepertoire,
): Promise<BodyOutcome> {
  const room = await mayAddRepertoire(getDb(), account);
  if (!room.ok) return refused(room.refusal);
  const moves = imported.graph.moves.length;
  const fits = canHoldMoves(account, { before: 0, after: moves });
  if (!fits.ok) return refused(fits.refusal);
  return { ok: true, preview: newPreview(imported) };
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
  const limited = await withinRateLimit(account, PREVIEWS, now);
  if (limited !== null) return limited;
  const request = previewRequestSchema.safeParse(input);
  if (!request.success) return requestRefused(request.error);
  const imported = importFile(request.data);
  if (!imported.ok) return imported;
  const { text, side, into, fileName } = request.data;
  const body = await previewBody(account, into, imported.value);
  if (!body.ok) return body;
  const suggestedSide = sideToSuggest(text, side, imported.value);
  const suggestedName = suggestedRepertoireName(
    text,
    fileName ?? null,
    REPERTOIRE_NAME_MAX,
  );
  return {
    ok: true,
    preview: { ...body.preview, suggestedSide, suggestedName },
  };
}

/** The preview of `imported` as a new repertoire, or merged `into` one. */
async function previewBody(
  account: Account,
  into: string | undefined,
  imported: ImportedRepertoire,
): Promise<BodyOutcome> {
  if (into === undefined) return previewNew(account, imported);
  const merge = await mergeIntoOwn(account, into, imported);
  if (!merge.ok) return merge;
  const { loaded, merged } = merge;
  return {
    ok: true,
    preview: mergedPreview(loaded, imported, merged),
  };
}

/**
 * Adds `imported` to an existing repertoire. editRepertoire decides and
 * saves it under the row lock: not found, then stale (changed since the
 * preview), then the merge's refusal (the other side, or nothing to add,
 * R-115), then the R-162 move limit; nothing is written on any refusal.
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
 * games added to an existing one. The text is imported again here, and
 * the R-162 limits are decided again where it is saved.
 */
export async function confirmImport(
  account: Account,
  input: unknown,
  now: Date,
): Promise<ConfirmOutcome> {
  const limited = await withinRateLimit(account, CONFIRMS, now);
  if (limited !== null) return limited;
  const request = confirmRequestSchema.safeParse(input);
  if (!request.success) return requestRefused(request.error);
  const imported = importFile(request.data);
  if (!imported.ok) return imported;
  const { side, target } = request.data;
  if (target.kind === 'existing') {
    return importInto(account, target, imported.value, now);
  }
  const created = await createRepertoire(getDb(), {
    ownerId: account.id,
    side,
    name: target.name,
    graph: imported.value.graph,
    now,
  });
  if (!created.ok) return refused(created.refusal);
  return {
    ok: true,
    id: created.value,
    chapterId: imported.value.graph.chapters[0]?.id ?? null,
  };
}
