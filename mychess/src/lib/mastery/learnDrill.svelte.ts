// mychess/src/lib/mastery/learnDrill.svelte.ts
//
// The Learn page's per-attempt state machine, extracted off the +page.svelte
// it used to live inline in. Owns one attempt's ply position, phase
// ('playing'|'advancing'|'autoplay'|'transition'), lock, hint, and mistake
// bookkeeping — nothing about the teach-cue overlay (deliberately survives a
// reset, so it stays page-side), review navigation, Explore mode, or the
// async report/nextAttempt cycle against the server.
//
// Three callbacks are the seam:
// - `onFinalMove` fires synchronously, the instant the attempt's last player
//   move lands correctly — before any hold — so the page can start the
//   network report immediately and let it overlap the hold instead of
//   stacking after it.
// - `onCueRetest` fires when a clean teach pass is about to be re-served as a
//   blind retest of the same moves, at the moment the page should raise the
//   "now play it from memory" cue.
// - `onAttemptFinished` fires once every internal hold has elapsed and it's
//   safe to load the next attempt.
// Sound, analytics (`logMove`), the network report()/nextAttempt() cycle, and
// the teach-cue overlay itself are all page-side reactions to these.
import type { VariationStep } from './variations';
import { playOpponentReplies } from './playback';
import { isLastPlayerMove } from './teaching';

export type LearnPhase = 'playing' | 'advancing' | 'autoplay' | 'transition';

/** The correct-move hold, before the board advances past it. */
const CORRECT_HOLD_MS = 500;
/** How long the teach-cue's "now play it from memory" message holds before
 * the board actually resets for the blind retest. The page's own cue overlay
 * lingers additionally OVER that reset — see +page.svelte's CUE_LINGER_MS. */
export const CUE_HOLD_MS = 1200;
/** How long each already-mastered ply is shown during the autoplay intro. */
const AUTO_PLAY_STEP_MS = 700;

export type LearnDrillCallbacks = {
	onFinalMove: (hadMistake: boolean) => void;
	onCueRetest: () => void;
	onAttemptFinished: () => void;
};

export type LearnDrillStartOptions = {
	/** Leading plies already known — auto-played before the player is asked
	 * to move (see `mastery/teaching.ts`'s `autoPlayCeiling`). */
	autoPlayThrough: number;
	/** Whether a clean finish of THIS attempt should be re-served as a blind
	 * retest cue rather than moving straight on — decided page-side from the
	 * attempt's own `arrowPlies`/`isFinalPass`. */
	cueRetestEligible: boolean;
};

export class LearnDrill {
	quizIdx = $state(0);
	boardFen = $state('');
	phase = $state<LearnPhase>('playing');
	locked = $state(false);
	hintRequested = $state(false);
	attemptHadMistake = $state(false);
	attemptMistakeCount = $state(0);
	lastMoveResult = $state<'correct' | 'wrong' | null>(null);

	private steps: readonly VariationStep[] = [];
	private cueRetestEligible = false;
	private advanceTimeout: ReturnType<typeof setTimeout> | undefined;
	private autoPlayTimeout: ReturnType<typeof setTimeout> | undefined;

	constructor(private callbacks: LearnDrillCallbacks) {}

	/** Loads a new attempt. Safe to call with an empty path (nothing to drill). */
	start(steps: readonly VariationStep[], opts: LearnDrillStartOptions) {
		clearTimeout(this.advanceTimeout);
		clearTimeout(this.autoPlayTimeout);
		this.advanceTimeout = undefined;
		this.autoPlayTimeout = undefined;
		this.steps = steps;
		this.quizIdx = 0;
		this.phase = 'playing';
		this.locked = false;
		this.hintRequested = false;
		this.attemptHadMistake = false;
		this.attemptMistakeCount = 0;
		this.lastMoveResult = null;
		this.cueRetestEligible = opts.cueRetestEligible;
		if (steps.length === 0) {
			this.boardFen = '';
			return;
		}
		this.boardFen = steps[0].fromFen;
		if (opts.autoPlayThrough > 0) {
			this.phase = 'autoplay';
			// The first step runs synchronously (like the rest of `start()`) —
			// only the recursive continuations are paced by AUTO_PLAY_STEP_MS.
			this.runAutoPlay(opts.autoPlayThrough);
		} else {
			this.advancePastOpponentReplies();
		}
	}

	private runAutoPlay(target: number) {
		if (this.quizIdx >= target) {
			this.phase = 'playing';
			this.advancePastOpponentReplies();
			return;
		}
		this.boardFen = this.steps[this.quizIdx].toFen;
		this.quizIdx++;
		this.autoPlayTimeout = setTimeout(() => this.runAutoPlay(target), AUTO_PLAY_STEP_MS);
	}

	private advancePastOpponentReplies() {
		const played = playOpponentReplies(this.steps, this.quizIdx, this.boardFen);
		this.quizIdx = played.plyIdx;
		this.boardFen = played.fen;
	}

	/**
	 * Attempts the player's move. Returns synchronously — whether it was the
	 * book move, the step's id, and whether it was the attempt's last player
	 * move — so the caller can play a sound and log the attempt immediately.
	 * Returns null while not actually waiting for a move (locked, mid-autoplay,
	 * or no current step).
	 */
	attemptMove(from: string, to: string, san: string): { correct: boolean; moveId: string; isFinalMove: boolean } | null {
		if (this.locked || this.phase !== 'playing') return null;
		const step = this.steps[this.quizIdx];
		if (!step) return null;

		if (san === step.san) {
			this.locked = true;
			this.lastMoveResult = 'correct';
			// Cleared here, not at the top of the next ply: a hint is scoped to
			// the ply it was taken on, distinct from `attemptHadMistake`, which
			// marks the whole attempt for good.
			this.hintRequested = false;
			const isFinalMove = isLastPlayerMove(this.steps, this.quizIdx);
			if (isFinalMove) this.callbacks.onFinalMove(this.attemptHadMistake);
			const cueRetest = isFinalMove && !this.attemptHadMistake && this.cueRetestEligible;

			this.advanceTimeout = setTimeout(() => {
				this.boardFen = step.toFen;
				this.quizIdx++;
				this.advancePastOpponentReplies();
				this.locked = false;
				this.lastMoveResult = null;
				if (this.quizIdx >= this.steps.length) {
					if (cueRetest) {
						this.phase = 'transition';
						this.callbacks.onCueRetest();
						this.advanceTimeout = setTimeout(() => {
							this.phase = 'advancing';
							this.callbacks.onAttemptFinished();
						}, CUE_HOLD_MS);
					} else {
						this.phase = 'advancing';
						this.callbacks.onAttemptFinished();
					}
				}
			}, CORRECT_HOLD_MS);
			return { correct: true, moveId: step.moveId, isFinalMove };
		}

		// Not revealed, not locked: the whole attempt stops being clean, but the
		// player keeps trying the same ply rather than the line ending.
		this.lastMoveResult = 'wrong';
		this.attemptHadMistake = true;
		this.attemptMistakeCount++;
		return { correct: false, moveId: step.moveId, isFinalMove: false };
	}

	/** Marks the attempt dirty. No guard, matching the page's original — a
	 * hint stays cheap to call even while nothing would visibly change. */
	requestHint() {
		this.hintRequested = true;
		this.attemptHadMistake = true;
	}
}
