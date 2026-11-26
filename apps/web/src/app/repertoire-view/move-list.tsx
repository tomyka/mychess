'use client';

import {
  annotatedSan,
  chapterTree,
  isPlayerMove,
  moveKey,
  moveNumber,
  sideToMove,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type JSX } from 'react';
import {
  lineTokens,
  rowsOf,
  type MovesRow,
  type MoveToken,
  type Token,
} from './move-rows';
import { revealInScroller } from './reveal-in-scroller';

export interface MoveListProps {
  readonly graph: RepertoireGraph;
  readonly chapterId: string | null;
  /** The moves to the shown position; its last one is the current move. */
  readonly path: readonly RepertoireMove[];
  /** The viewer's own notes by move key: Personal notes, or a coach's own. */
  readonly notedMoves: Readonly<Record<string, string>>;
  /**
   * Whose notes `notedMoves` are, and so their mark: the owner's private
   * Personal notes (a lock, the default) or the viewing coach's own notes
   * on a shared repertoire (a pen; docs/design/coach-shared-repertoire.md).
   */
  readonly noteKind?: NoteKind | undefined;
  /**
   * The moves carrying a coach note the repertoire kept as a fork (R-47):
   * a pen, next to the viewer's own mark.
   */
  readonly keptNoteMoves?: ReadonlySet<string> | undefined;
  readonly onGoto: (path: readonly RepertoireMove[]) => void;
  /** Builder mode: an empty chapter asks for its first move. */
  readonly building?: boolean;
}

/** Whose notes the list marks: see `MoveListProps.noteKind`. */
type NoteKind = 'personal' | 'coach';

/** A mark after a SAN: the viewer's own note, or a fork's kept coach note. */
type NoteMark = NoteKind | 'kept';

const NO_KEPT_NOTES: ReadonlySet<string> = new Set();

const pathId = (path: readonly RepertoireMove[]): string =>
  path.map((m) => moveKey(m.from, m.san)).join(' ');

interface ListContext {
  readonly graph: RepertoireGraph;
  readonly whiteFirst: boolean;
  readonly current: string;
  readonly notedMoves: Readonly<Record<string, string>>;
  readonly noteKind: NoteKind;
  readonly keptNoteMoves: ReadonlySet<string>;
  readonly onGoto: (path: readonly RepertoireMove[]) => void;
}

/** What each mark means, as the chip's name says it. */
const MARK_WORD = {
  personal: 'hasNote',
  coach: 'hasCoachNote',
  kept: 'hasKeptCoachNote',
} as const;

/** The chip's accessible name: number and SAN, then what the move carries. */
function useChipLabel(text: string, glyphs: ChipGlyphs): string {
  const t = useTranslations('repertoires.moves');
  return [
    text,
    ...(glyphs.comment ? [t('hasComment')] : []),
    ...glyphs.marks.map((mark) => t(MARK_WORD[mark])),
    ...(glyphs.transposes ? [t('transposes')] : []),
  ].join(', ');
}

/** A transposing chip's hover title, what its two-arrow mark means; none otherwise. */
function useTransposesHint(transposes: boolean): string | undefined {
  const t = useTranslations('repertoires.moves');
  return transposes ? t('transposesHint') : undefined;
}

/** What a chip marks after its SAN; the chip's name says each in words. */
interface ChipGlyphs {
  readonly comment: boolean;
  readonly marks: readonly NoteMark[];
  readonly transposes: boolean;
}

/** The marks of the move `key`: the viewer's own note, then a kept one. */
function marksOf(context: ListContext, key: string): NoteMark[] {
  return [
    ...(context.notedMoves[key] === undefined ? [] : [context.noteKind]),
    ...(context.keptNoteMoves.has(key) ? ['kept' as const] : []),
  ];
}

/**
 * A move's chip, named by its number and SAN: a touch target on a phone,
 * compact (28px) on a desktop, where the pointer is precise.
 */
function MoveChip({
  token,
  context,
}: {
  readonly token: MoveToken;
  readonly context: ListContext;
}): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  const { move } = token;
  const number = moveNumber(token.ply, context.whiteFirst);
  const isCurrent = pathId(token.path) === context.current;
  const glyphs: ChipGlyphs = {
    comment: move.comment !== null,
    marks: marksOf(context, moveKey(move.from, move.san)),
    transposes: token.transposes,
  };
  const san = annotatedSan(move.san, move.nags);
  const label = useChipLabel(`${number} ${san}`, glyphs);
  const hint = useTransposesHint(token.transposes);
  useEffect(() => {
    const chip = ref.current;
    if (isCurrent && chip !== null) revealInScroller(chip);
  }, [isCurrent]);
  const weight = isPlayerMove(context.graph, move) ? 'font-semibold' : '';
  const tone = isCurrent ? 'bg-accent text-accent-fg' : 'text-fg';
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={hint}
      aria-current={isCurrent ? 'true' : undefined}
      onClick={() => {
        context.onGoto(token.path);
      }}
      className={`inline-flex min-h-touch min-w-touch items-center justify-center gap-1 rounded-control px-2 text-base tabular-nums lg:min-h-7 lg:min-w-0 lg:px-1.5 ${weight} ${tone}`}
    >
      {san}
      <MoveGlyphs glyphs={glyphs} />
    </button>
  );
}

/** A chip inside a variation, after its number where the line needs one. */
function InlineMove({
  token,
  context,
}: {
  readonly token: MoveToken;
  readonly context: ListContext;
}): JSX.Element {
  const number = moveNumber(token.ply, context.whiteFirst);
  // White's moves always show their number; Black's only when `numbered`.
  const showNumber = token.numbered || !number.endsWith('...');
  // The number and its move wrap as one, so "6." never ends a line alone.
  return (
    <span className="inline-flex items-center gap-x-1 whitespace-nowrap">
      {showNumber ? (
        <span aria-hidden="true" className="text-fg-muted tabular-nums">
          {number}
        </span>
      ) : null}
      <MoveChip token={token} context={context} />
    </span>
  );
}

const PEN = 'M11 1.5l3.5 3.5-8.5 8.5H2.5V10zM2 15h12v-1H2z';

/**
 * The note marks: a lock for a private Personal note, a pen for a coach's
 * note, the viewing coach's own or one a fork kept.
 */
const NOTE_GLYPH: Readonly<Record<NoteMark, string>> = {
  personal: 'M5 7V5a3 3 0 0 1 6 0v2h1v7H4V7zm2 0h2V5a1 1 0 0 0-2 0z',
  coach: PEN,
  kept: PEN,
};

/** The small comment and note marks after a SAN; their meaning is in the chip's name. */
function MoveGlyphs({
  glyphs,
}: {
  readonly glyphs: ChipGlyphs;
}): JSX.Element | null {
  const { comment, marks, transposes } = glyphs;
  if (!comment && marks.length === 0 && !transposes) return null;
  return (
    <span aria-hidden="true" className="flex gap-0.5 text-xs">
      {transposes ? (
        // Two opposite arrows: the line goes on where it was shown already.
        <svg
          viewBox="0 0 16 16"
          className="size-3"
          fill="currentColor"
          data-transposition=""
        >
          <path d="M2 5h9V2.5L15 6l-4 3.5V7H2zM14 11H5V8.5L1 12l4 3.5V13h9z" />
        </svg>
      ) : null}
      {comment ? (
        <svg viewBox="0 0 16 16" className="size-3" fill="currentColor">
          <path d="M2 3h12v8H6l-3 3v-3H2z" />
        </svg>
      ) : null}
      {marks.map((mark) => (
        <svg
          key={mark}
          viewBox="0 0 16 16"
          className="size-3"
          fill="currentColor"
          data-note={mark}
        >
          <path d={NOTE_GLYPH[mark]} />
        </svg>
      ))}
    </span>
  );
}

/** Variations indent up to three levels; deeper ones keep that indent. */
const MAX_INDENT = 3;

/** A block's key: the moves to its first move. */
const blockKey = (block: readonly Token[]): string =>
  pathId(block[0]?.kind === 'move' ? block[0].path : []);

/** Each alternative as an indented block, its moves written inline. */
function VariationBlocks({
  blocks,
  depth,
  context,
}: {
  readonly blocks: readonly (readonly Token[])[];
  readonly depth: number;
  readonly context: ListContext;
}): JSX.Element {
  return (
    <>
      {blocks.map((block) => (
        <div
          key={blockKey(block)}
          data-variation=""
          className={`flex w-full flex-wrap items-center gap-x-1 border-l border-border ${depth < MAX_INDENT ? 'pl-3' : ''}`}
        >
          <Tokens tokens={block} depth={depth + 1} context={context} />
        </div>
      ))}
    </>
  );
}

/** A variation's moves inline, wrapping, with its own variations nested. */
function Tokens({
  tokens,
  depth,
  context,
}: {
  readonly tokens: readonly Token[];
  readonly depth: number;
  readonly context: ListContext;
}): JSX.Element {
  return (
    <>
      {tokens.map((token) =>
        token.kind === 'move' ? (
          <InlineMove
            key={pathId(token.path)}
            token={token}
            context={context}
          />
        ) : (
          <VariationBlocks
            key={blockKey(token.blocks[0] ?? [])}
            blocks={token.blocks}
            depth={depth}
            context={context}
          />
        ),
      )}
    </>
  );
}

/** Where a row has no move of White's: Black's move starts it. */
const NO_WHITE_MOVE = '…';

/** A numbered row of the main line: number, White's move, Black's move. */
function MovesRowView({
  row,
  context,
}: {
  readonly row: MovesRow;
  readonly context: ListContext;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[2.5rem_1fr_1fr] items-center justify-items-start gap-x-1">
      <span aria-hidden="true" className="text-fg-muted tabular-nums">
        {row.number}
      </span>
      {row.white === null ? (
        <span aria-hidden="true" className="px-2 text-fg-muted lg:px-1.5">
          {NO_WHITE_MOVE}
        </span>
      ) : (
        <MoveChip token={row.white} context={context} />
      )}
      {row.black === null ? (
        <span />
      ) : (
        <MoveChip token={row.black} context={context} />
      )}
    </div>
  );
}

/** The main line in numbered rows, each run of variations a row of blocks. */
function MoveRows({
  tokens,
  context,
}: {
  readonly tokens: readonly Token[];
  readonly context: ListContext;
}): JSX.Element {
  return (
    <>
      {rowsOf(tokens, context.whiteFirst).map((row) =>
        row.kind === 'moves' ? (
          <MovesRowView
            key={pathId((row.white ?? row.black)?.path ?? [])}
            row={row}
            context={context}
          />
        ) : (
          <div
            key={blockKey(row.blocks[0] ?? [])}
            data-variations=""
            className="flex flex-col"
          >
            <VariationBlocks blocks={row.blocks} depth={0} context={context} />
          </div>
        ),
      )}
    </>
  );
}

/**
 * The chapter's moves (docs/design/repertoire-screen.md, "The move list"):
 * the main line in numbered two-column rows, each run of variations an
 * indented block written inline, after which the main line goes on in a
 * new row. Every move is a button in reading order; the current one is
 * marked and kept in view.
 */
export function MoveList(props: MoveListProps): JSX.Element {
  const t = useTranslations('repertoires');
  const { graph, chapterId, path, notedMoves, onGoto } = props;
  const tree = chapterId === null ? [] : chapterTree(graph, chapterId);
  const root = tree[0]?.move.from;
  const context: ListContext = {
    graph,
    whiteFirst: root === undefined || sideToMove(root) === 'w',
    current: pathId(path),
    notedMoves,
    noteKind: props.noteKind ?? 'personal',
    keptNoteMoves: props.keptNoteMoves ?? NO_KEPT_NOTES,
    onGoto,
  };
  return (
    <section aria-label={t('moves.title')} className="flex flex-col">
      {tree.length === 0 ? (
        <p className="text-fg-muted">
          {props.building === true
            ? t('builder.playFirst')
            : t('panel.noMoves')}
        </p>
      ) : (
        <MoveRows tokens={lineTokens(tree, 0, [])} context={context} />
      )}
    </section>
  );
}
