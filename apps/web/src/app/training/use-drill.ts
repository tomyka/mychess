'use client';

// The drill core (#384): what both drills do the same way around their
// session. It keeps the drill's state with its frame drawn on the board,
// ends each answer's flash in time, takes moves from the board and the move
// field (a refused piece put back, an unknown typed move marked), records
// each step's result with the clock's id and time (R-60), holds a right
// answer for its flash or, while its Coach notes or the other answers wait
// to be read, until Next (R-174, #330 decision 4), lets the opponent's move
// slide in, and reads where the player's day stands. A drill supplies only
// its rules: how it starts, what it asks, how a move is answered and what
// comes next.
import {
  dayStanding,
  trainingProgress,
  type BoardMove,
  type DayStanding,
  type RepertoireMove,
  type TrainingDay,
  type TrainingProgress,
} from '@mychess/chess';
import { dayEnd } from '@mychess/domain';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { TrainingData } from '../../lib/training-data';
import { dayOf } from '../../lib/training-day';
import { MOVE_DURATION, type BoardView } from '../board/board-config';
import { putBack, typedUnknown, type DrillCore, type Step } from './drill-core';
import { useDrillBoard } from './drill-board';
import type { Color, DrillFrame, Flash } from './drill-frame';
import {
  FEEDBACK_MS,
  useMoveInput,
  useTimer,
  type DrillClock,
  type MoveInput,
} from './drill-input';
import {
  drillNotices,
  hasNotices,
  namedOf,
  type DrillNotices,
} from './drill-notices';
import type { HeaderItem } from './session-header';
import type { ResultSync } from './use-result-sync';

/** The move whose notices show now (R-174, R-54). */
interface Noticed {
  readonly move: RepertoireMove | undefined;
  /** Do they hold a right answer until Next? */
  readonly holds: boolean;
}

/** What a drill supplies: module functions, so the drill keeps them. */
export interface DrillRules<S extends DrillCore> {
  /** The drill on the page's training day, at `now`. */
  readonly start: (c: {
    readonly day: TrainingDay;
    readonly data: TrainingData;
    readonly now: Date;
  }) => S;
  /** What the drill shows now. */
  readonly frameOf: (s: S) => DrillFrame;
  /** The player's legal `move`, answered at `now`. */
  readonly play: (s: S, move: BoardMove, now: Date) => Step<S>;
  readonly noticed: (s: S) => Noticed;
  /** A right answer is on the board, before what comes next. */
  readonly answeredRight: (s: S) => boolean;
  /** What comes after a right answer, at `now`. */
  readonly onward: (s: S, day: TrainingDay, now: Date) => S;
  /** The opponent's move slides in; the board waits for it. */
  readonly sliding: (s: S) => boolean;
  /** Once it has slid in. */
  readonly slid: (s: S) => S;
}

/** The drill as its component draws it. */
export interface Drill<S> extends MoveInput, DrillNotices {
  readonly state: S;
  readonly view: BoardView;
  /** The item drilled, for the header's context line (R-224). */
  readonly item: HeaderItem | undefined;
  /** The side asked to move, also while a wrong move is held (#381). */
  readonly toMove: Color;
  /**
   * On to what comes next, once a right answer's notices hold the drill;
   * null otherwise, the drill then going on by itself.
   */
  readonly next: (() => void) | null;
  /** Where the repertoires stand now, by the drill's Reviews. */
  readonly progress: () => TrainingProgress;
  /** Where the player's day stands now (#319). */
  readonly standing: () => DayStanding;
}

/** The core of a drill, with what the drill adds its own steps through. */
export interface DrillCoreHook<S> {
  readonly drill: Drill<S>;
  /** The page's training day. */
  readonly day: TrainingDay;
  /** Takes `step` at the clock's time: records its result, keeps its state. */
  readonly take: (step: (s: S, now: Date) => Step<S>) => void;
}

export interface DrillContext {
  readonly data: TrainingData;
  /** Each result is queued here and synced (R-60). */
  readonly sync: ResultSync;
  readonly clock: DrillClock;
}

type SetState<S> = Dispatch<SetStateAction<S>>;

/** Ends each flash after its time, unless a newer one took its place. */
function useUnflash<S extends DrillCore>(
  flash: Flash | null,
  setState: SetState<S>,
): void {
  const unflash = useMemo(
    () => () => {
      setState((s) => (s.flash === flash ? { ...s, flash: null } : s));
    },
    [setState, flash],
  );
  useTimer(flash !== null, FEEDBACK_MS, unflash);
}

/**
 * The timed steps: a right answer goes on after its flash unless `held`,
 * and the opponent's move slides in. Returns the step on, for Next.
 */
function useDrillTimers<S extends DrillCore>(
  rules: DrillRules<S>,
  state: S,
  setState: SetState<S>,
  c: { readonly day: TrainingDay; readonly clock: DrillClock; held: boolean },
): () => void {
  const { day, clock } = c;
  const onward = useMemo(
    () => () => {
      const now = clock.now();
      setState((s) => rules.onward(s, day, now));
    },
    [rules, setState, day, clock],
  );
  useTimer(rules.answeredRight(state) && !c.held, FEEDBACK_MS, onward);
  const slid = useMemo(
    () => () => {
      setState(rules.slid);
    },
    [rules, setState],
  );
  useTimer(rules.sliding(state), MOVE_DURATION, slid);
  return onward;
}

/** Where the player's day stands by `reviews`, read at the clock's time. */
function dayView(
  day: TrainingDay,
  reviews: TrainingDay['reviews'],
  clock: DrillClock,
): Pick<Drill<unknown>, 'progress' | 'standing'> {
  const progressAt = (now: Date) =>
    trainingProgress({ repertoires: day.repertoires, reviews }, now);
  return {
    progress: () => progressAt(clock.now()),
    standing: () => {
      const now = clock.now();
      return dayStanding(progressAt(now), dayEnd(now));
    },
  };
}

/** The drill's notices now, and whether they hold its right answer. */
function useNotices<S extends DrillCore>(
  rules: DrillRules<S>,
  data: TrainingData,
  state: S,
  repertoireId: string | undefined,
): { readonly notices: DrillNotices; readonly held: boolean } {
  const named = useMemo(() => namedOf(data), [data]);
  const { move, holds } = rules.noticed(state);
  const notices = drillNotices(data, named, repertoireId, move);
  const held = rules.answeredRight(state) && holds && hasNotices(notices);
  return { notices, held };
}

/** The drill over `rules`, on `c.data`'s training day. */
export function useDrill<S extends DrillCore>(
  rules: DrillRules<S>,
  c: DrillContext,
): DrillCoreHook<S> {
  const { data, sync, clock } = c;
  const day = useMemo(() => dayOf(data), [data]);
  const [state, setState] = useState(() =>
    rules.start({ day, data, now: clock.now() }),
  );
  const frame = useMemo(() => rules.frameOf(state), [rules, state]);
  const { notices, held } = useNotices(rules, data, state, frame.repertoireId);
  const onward = useDrillTimers(rules, state, setState, { day, clock, held });
  const { view, legal, item } = useDrillBoard(data, frame);
  useUnflash(state.flash, setState);
  const take = (step: (s: S, now: Date) => Step<S>): void => {
    const now = clock.now();
    const { state: after, result } = step(state, now);
    if (result !== null)
      sync.record({ resultId: clock.newId(), ...result, answeredAt: now });
    setState(after);
  };
  const input = useMoveInput({
    position: frame.asked,
    legal,
    canPlay: frame.playable,
    canType: frame.typeable,
    play(move) {
      take((s, now) => rules.play(s, move, now));
    },
    putBack() {
      setState(putBack);
    },
    unknown() {
      setState(typedUnknown(state));
    },
  });
  const drill: Drill<S> = {
    ...input,
    ...notices,
    ...dayView(day, state.reviews, clock),
    state,
    view,
    item,
    toMove: frame.toMove,
    next: held ? onward : null,
  };
  return { drill, day, take };
}
