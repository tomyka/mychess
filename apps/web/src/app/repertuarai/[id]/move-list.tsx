'use client';

import {
  chapterTree,
  isPlayerMove,
  moveKey,
  sideToMove,
  type RepertoireGraph,
  type RepertoireMove,
  type WalkedMove,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type JSX } from 'react';
import { moveNumber } from './board-play';

export interface MoveListProps {
  readonly graph: RepertoireGraph;
  readonly chapterId: string | null;
  /** The moves to the shown position; its last one is the current move. */
  readonly path: readonly RepertoireMove[];
  /** The viewer's Personal notes by move key. */
  readonly notes: Readonly<Record<string, string>>;
  readonly onGoto: (path: readonly RepertoireMove[]) => void;
}

/** A move chip, or the variations that branch off before the next one. */
type Token =
  | {
      readonly kind: 'move';
      readonly move: RepertoireMove;
      readonly ply: number;
      readonly path: readonly RepertoireMove[];
      /** Black's number shows at the start of a block or after variations. */
      readonly numbered: boolean;
    }
  | { readonly kind: 'variations'; readonly blocks: readonly Token[][] };

/**
 * A line of the chapter's tree as tokens: the main move at each position,
 * its alternatives as variation blocks right after it, then the main line
 * goes on. Loops along the main line; recurses only into variations.
 */
function lineTokens(
  nodes: readonly WalkedMove[],
  ply: number,
  path: readonly RepertoireMove[],
): Token[] {
  const tokens: Token[] = [];
  let numbered = true;
  for (
    let at = nodes, p = ply, before = path;
    at[0] !== undefined;
    at = at[0].next, p += 1
  ) {
    const [main, ...alternatives] = at;
    const mainPath = [...before, main.move];
    tokens.push({
      kind: 'move',
      move: main.move,
      ply: p,
      path: mainPath,
      numbered,
    });
    if (alternatives.length > 0)
      tokens.push({
        kind: 'variations',
        blocks: alternatives.map((alt) => lineTokens([alt], p, before)),
      });
    numbered = alternatives.length > 0;
    before = mainPath;
  }
  return tokens;
}

const pathId = (path: readonly RepertoireMove[]): string =>
  path.map((m) => moveKey(m.from, m.san)).join(' ');

interface ListContext {
  readonly graph: RepertoireGraph;
  readonly whiteFirst: boolean;
  readonly current: string;
  readonly notes: Readonly<Record<string, string>>;
  readonly onGoto: (path: readonly RepertoireMove[]) => void;
}

function MoveChip({
  token,
  context,
}: {
  readonly token: Extract<Token, { kind: 'move' }>;
  readonly context: ListContext;
}): JSX.Element {
  const t = useTranslations('repertoires.moves');
  const ref = useRef<HTMLButtonElement>(null);
  const { move } = token;
  const number = moveNumber(token.ply, context.whiteFirst);
  const isCurrent = pathId(token.path) === context.current;
  const hasNote = context.notes[moveKey(move.from, move.san)] !== undefined;
  const label = [
    `${number} ${move.san}`,
    ...(move.comment === null ? [] : [t('hasComment')]),
    ...(hasNote ? [t('hasNote')] : []),
  ].join(', ');
  useEffect(() => {
    const chip = ref.current;
    if (isCurrent && typeof chip?.scrollIntoView === 'function')
      chip.scrollIntoView({ block: 'nearest' });
  }, [isCurrent]);
  // White's moves always show their number; Black's only when `numbered`.
  const showNumber = token.numbered || !number.endsWith('...');
  const weight = isPlayerMove(context.graph, move) ? 'font-semibold' : '';
  const tone = isCurrent ? 'bg-accent text-accent-fg' : 'text-fg';
  return (
    <>
      {showNumber ? (
        <span aria-hidden="true" className="text-fg-muted tabular-nums">
          {number}
        </span>
      ) : null}
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-current={isCurrent ? 'true' : undefined}
        onClick={() => {
          context.onGoto(token.path);
        }}
        className={`inline-flex min-h-touch min-w-touch items-center justify-center gap-1 rounded-control px-2 text-base tabular-nums ${weight} ${tone}`}
      >
        {move.san}
        <MoveGlyphs comment={move.comment !== null} note={hasNote} />
      </button>
    </>
  );
}

/** The small comment and note marks after a SAN; their meaning is in the chip's name. */
function MoveGlyphs({
  comment,
  note,
}: {
  readonly comment: boolean;
  readonly note: boolean;
}): JSX.Element | null {
  if (!comment && !note) return null;
  return (
    <span aria-hidden="true" className="flex gap-0.5 text-xs">
      {comment ? (
        <svg viewBox="0 0 16 16" className="size-3" fill="currentColor">
          <path d="M2 3h12v8H6l-3 3v-3H2z" />
        </svg>
      ) : null}
      {note ? (
        <svg viewBox="0 0 16 16" className="size-3" fill="currentColor">
          <path d="M5 7V5a3 3 0 0 1 6 0v2h1v7H4V7zm2 0h2V5a1 1 0 0 0-2 0z" />
        </svg>
      ) : null}
    </span>
  );
}

/** Variations indent up to three levels; deeper ones keep that indent. */
const MAX_INDENT = 3;

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
          <MoveChip key={pathId(token.path)} token={token} context={context} />
        ) : (
          token.blocks.map((block) => (
            <div
              key={pathId(block[0]?.kind === 'move' ? block[0].path : [])}
              data-variation=""
              className={`flex w-full flex-wrap items-center gap-x-1 border-l border-border ${depth < MAX_INDENT ? 'pl-3' : ''}`}
            >
              <Tokens tokens={block} depth={depth + 1} context={context} />
            </div>
          ))
        ),
      )}
    </>
  );
}

/**
 * The chapter's moves (docs/design/repertoire-screen.md, "The move list"):
 * the main line as chips, each variation an indented block. Every move is a
 * button in reading order; the current one is marked and kept in view.
 */
export function MoveList(props: MoveListProps): JSX.Element {
  const t = useTranslations('repertoires');
  const { graph, chapterId, path, notes, onGoto } = props;
  const tree = chapterId === null ? [] : chapterTree(graph, chapterId);
  const root = tree[0]?.move.from;
  const context: ListContext = {
    graph,
    whiteFirst: root === undefined || sideToMove(root) === 'w',
    current: pathId(path),
    notes,
    onGoto,
  };
  return (
    <section
      aria-label={t('moves.title')}
      className="flex flex-wrap items-center gap-x-1"
    >
      {tree.length === 0 ? (
        <p className="text-fg-muted">{t('panel.noMoves')}</p>
      ) : (
        <Tokens tokens={lineTokens(tree, 0, [])} depth={0} context={context} />
      )}
    </section>
  );
}
