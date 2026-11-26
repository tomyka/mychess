'use client';

import {
  isPlayerMove,
  lines,
  moveKey,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, type JSX } from 'react';
import { SECONDARY_BUTTON } from '../buttons';
import { CHEVRON_DOWN_ICON, Icon } from '../line-icon';
import { currentLineIndex } from './current-line';
import { KnowChoice, type KnowFields } from './know-choice';
import { LearnLink } from './learn-link';
import { moveLabel } from './move-label';
import type { TrainNow } from '../../server/training';

/** Where the view stands: the chapter, the moves to the current one, its line. */
export interface Standpoint {
  readonly graph: RepertoireGraph;
  readonly chapterId: string;
  /** The moves from the chapter root to the current one. */
  readonly path: readonly RepertoireMove[];
  /** `currentLineIndex` of the path: null at the chapter root. */
  readonly line: number | null;
}

/** One of "I know this"'s choices, before it is put in words. */
export type KnowChoiceSpec =
  | {
      /** Its scope: a choice keyed by it counts afresh for another scope. */
      readonly key: string;
      readonly fields: Extract<KnowFields, { kind: 'move' }>;
      /** The move as the move list writes it ("5... Qc7"). */
      readonly label: string;
    }
  | {
      readonly key: string;
      readonly fields: Exclude<KnowFields, { kind: 'move' }>;
      /** The player moves the line or chapter covers. */
      readonly moves: number;
    };

/** The player moves among `moves`, by key, each once. */
const ownKeys = (
  graph: RepertoireGraph,
  moves: readonly RepertoireMove[],
): string[] =>
  moves
    .filter((m) => isPlayerMove(graph, m))
    .map((m) => moveKey(m.from, m.san));

/** The current move's choice, when it is the player's own. */
function moveChoices(at: Standpoint, repertoireId: string): KnowChoiceSpec[] {
  const move = at.path.at(-1);
  if (move === undefined || !isPlayerMove(at.graph, move)) return [];
  const key = moveKey(move.from, move.san);
  return [
    {
      key: `move:${key}`,
      fields: { kind: 'move', repertoireId, moveKey: key },
      label: moveLabel(at.graph, at.chapterId, at.path, move),
    },
  ];
}

/**
 * What "I know this" offers at `at` (R-227): the current move when it is
 * the player's own, the line it is on when there is one (none at the
 * chapter root), and the chapter always, each line and chapter with the
 * player moves it covers.
 */
export function knowChoices(
  at: Standpoint,
  repertoireId: string,
): KnowChoiceSpec[] {
  const { graph, chapterId, line } = at;
  const chapterLines = lines(graph, chapterId);
  const lineMoves = line === null ? undefined : chapterLines[line];
  return [
    ...moveChoices(at, repertoireId),
    ...(line === null || lineMoves === undefined
      ? []
      : [
          {
            key: `line:${chapterId}:${String(line)}`,
            fields: {
              kind: 'line' as const,
              repertoireId,
              chapterId,
              lineIndex: String(line),
            },
            moves: new Set(ownKeys(graph, lineMoves)).size,
          },
        ]),
    {
      key: `chapter:${chapterId}`,
      fields: { kind: 'chapter', repertoireId, chapterId },
      moves: new Set(chapterLines.flatMap((l) => ownKeys(graph, l))).size,
    },
  ];
}

/** A choice's subject in words: "This move, 5... Qc7", "This line, 7 moves". */
function useSubject(): (choice: KnowChoiceSpec) => string {
  const t = useTranslations('training.know');
  return (choice) =>
    'label' in choice
      ? t('move', { move: choice.label })
      : t(choice.fields.kind, { count: choice.moves });
}

/** The open "I know this": its choices, each counted again after any action. */
function KnowChoices({
  id,
  choices,
}: {
  readonly id: string;
  readonly choices: readonly KnowChoiceSpec[];
}): JSX.Element {
  const subject = useSubject();
  const [version, setVersion] = useState(0);
  const acted = (): void => {
    setVersion((v) => v + 1);
  };
  return (
    <div id={id} className="flex flex-col gap-2 border-l border-border pl-3">
      {choices.map((choice) => (
        <KnowChoice
          key={choice.key}
          fields={choice.fields}
          subject={subject(choice)}
          moves={'moves' in choice ? choice.moves : null}
          version={version}
          onActed={acted}
        />
      ))}
    </div>
  );
}

export interface TrainHereProps {
  readonly training: TrainNow;
  readonly graph: RepertoireGraph;
  readonly chapterId: string;
  /** The moves from the chapter root to the current one. */
  readonly path: readonly RepertoireMove[];
}

/**
 * Train here (spec, "Train here (browse)"): Learn this line and Learn this
 * chapter (R-206), each only while it would teach something today, and
 * one "I know this" (R-227) that opens the move, line and chapter choices
 * inline, each counted as it opens.
 */
export function TrainHere({
  training,
  graph,
  chapterId,
  path,
}: TrainHereProps): JSX.Element {
  const t = useTranslations('training.know');
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const { repertoireId } = training;
  const line = useMemo(
    () => currentLineIndex(graph, chapterId, path),
    [graph, chapterId, path],
  );
  const choices = useMemo(
    () => knowChoices({ graph, chapterId, path, line }, repertoireId),
    [graph, chapterId, path, line, repertoireId],
  );
  return (
    <section aria-label={t('section')} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {line === null ? null : (
          <LearnLink
            training={training}
            graph={graph}
            focus={{ chapterId, lineIndex: line }}
          />
        )}
        <LearnLink training={training} graph={graph} focus={{ chapterId }} />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => {
            setOpen(!open);
          }}
          className={`${SECONDARY_BUTTON} gap-1`}
        >
          {t('iKnowThis')}
          <Icon
            path={CHEVRON_DOWN_ICON}
            className={`size-4 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      {open ? <KnowChoices id={bodyId} choices={choices} /> : null}
    </section>
  );
}
