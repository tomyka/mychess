// mychess/src/lib/mastery/practiceDrill.svelte.ts
//
// The Practice pool's per-line state machine (#97/#98/#103/#113/#125/#131),
// extracted off the +page.svelte it used to live inline in. Owns exactly one
// line's ply position, lock, hint, mistake-preview, and status-strip phase —
// nothing about the queue, the session-wide pass/demote counts, review
// navigation, or Explore mode, all of which stay page-side and compose with
// this the same way the page already composes with ExploreSession.
//
// The two callbacks are the whole seam: `onOutcome` fires at most once per
// line, exactly when a reportable result is determined — synchronously for a
// mistake or a hint, but only after this module's own delay for a line played
// correctly to the end (the delay is what lets the player see the last move
// land before anything reports). `onAdvance` fires once it's time to move to
// the next queue entry; the page owns the queue, so it's the one thing this
// module can't just do itself. Sound, analytics (`logMove`), and the network
// report() call are all page-side reactions to these — I/O at the edge, same
// split as the rest of this codebase's lib/ vs lib/server/ convention, just
// applied client-side.
import { Chess } from 'chess.js';
import type { VariationStep } from './variations';
import { playOpponentReplies } from './playback';
import type { PracticeStripState as StripState } from '$lib/components/PracticeStatusStrip.svelte';

export type PracticeOutcome = 'clean' | 'mistake' | 'hint';
// A subset of the status strip's own states — kept as an Extract so a rename
// over there surfaces here as a type error instead of two names drifting.
export type PracticeStripState = Extract<StripState, 'blind' | 'correct' | 'demoted'>;

/** How long a correct move holds before the board advances past it. */
const CORRECT_HOLD_MS = 450;
/** How long a finished line holds before the queue advances. */
const LINE_COMPLETE_HOLD_MS = 700;
/** How long a demoted line holds before the queue advances. */
const DEMOTED_HOLD_MS = 1600;

type PracticeDrillCallbacks = {
	onOutcome: (outcome: PracticeOutcome) => void;
	onAdvance: () => void;
};

export class PracticeDrill {
	plyIdx = $state(0);
	boardFen = $state('');
	locked = $state(false);
	hintRequested = $state(false);
	// The position a wrong move produced, kept aside so the page's "see why"
	// excursion can open on the consequence rather than on the question. Never
	// applied to the drill's own boardFen.
	mistakeFen = $state<string | null>(null);
	strip = $state<PracticeStripState>('blind');

	private steps: readonly VariationStep[] = [];
	private outcomeReported = false;
	private advanceTimeout: ReturnType<typeof setTimeout> | undefined;

	constructor(private callbacks: PracticeDrillCallbacks) {}

	/** Loads a new line. Safe to call with an empty array (nothing to drill). */
	start(steps: readonly VariationStep[]) {
		clearTimeout(this.advanceTimeout);
		this.advanceTimeout = undefined;
		this.steps = steps;
		this.plyIdx = 0;
		this.locked = false;
		this.hintRequested = false;
		this.outcomeReported = false;
		this.mistakeFen = null;
		this.strip = 'blind';
		if (steps.length === 0) {
			this.boardFen = '';
			return;
		}
		const played = playOpponentReplies(steps, 0, steps[0].fromFen);
		this.plyIdx = played.plyIdx;
		this.boardFen = played.fen;
	}

	/**
	 * Attempts the player's move. Returns synchronously — whether it was the
	 * book move, and the step's id — so the caller can play a sound and log the
	 * attempt immediately, before any of this module's own delays resolve.
	 * Returns null for input that isn't a live attempt (locked, or no current
	 * step to play against).
	 */
	attemptMove(from: string, to: string, san: string): { correct: boolean; moveId: string } | null {
		if (this.locked) return null;
		const step = this.steps[this.plyIdx];
		if (!step) return null;

		if (san === step.san) {
			this.locked = true;
			if (!this.outcomeReported) this.strip = 'correct';
			this.advanceTimeout = setTimeout(() => this.advancePastCorrectMove(step), CORRECT_HOLD_MS);
			return { correct: true, moveId: step.moveId };
		}

		this.mistakeFen = computeMistakeFen(step.fromFen, from, to);
		// Only ends the line the FIRST time it's reported. A hinted line has
		// already reported its outcome without locking (the player keeps trying
		// until they find the book move), so a subsequent wrong move here must
		// stay a harmless no-op too — just the sound and the remembered mistake
		// position, nothing that locks or advances the queue.
		if (!this.outcomeReported) {
			this.locked = true;
			this.strip = 'demoted';
			this.reportOnce('mistake');
			this.advanceTimeout = setTimeout(() => this.callbacks.onAdvance(), DEMOTED_HOLD_MS);
		}
		return { correct: false, moveId: step.moveId };
	}

	private advancePastCorrectMove(step: VariationStep) {
		const played = playOpponentReplies(this.steps, this.plyIdx + 1, step.toFen);
		this.plyIdx = played.plyIdx;
		this.boardFen = played.fen;
		this.locked = false;
		if (this.plyIdx >= this.steps.length) {
			this.reportOnce('clean');
			this.advanceTimeout = setTimeout(() => this.callbacks.onAdvance(), LINE_COMPLETE_HOLD_MS);
		} else if (!this.outcomeReported) {
			this.strip = 'blind';
		}
		// If already reported (a hint was taken earlier on this line), the
		// demoted notice stays up rather than flipping back to 'blind' — that
		// would suggest the pass still counted.
	}

	/**
	 * Reported immediately rather than at the end of the line: a player who
	 * takes a hint and then navigates away has still had the answer. Does not
	 * end the line — the demoted notice stays up while it's played out.
	 * Returns whether the request was accepted, so the page knows whether to
	 * also clear its own review-nav state.
	 */
	requestHint(): boolean {
		if (this.hintRequested || this.locked) return false;
		this.hintRequested = true;
		this.reportOnce('hint');
		this.strip = 'demoted';
		return true;
	}

	/** For the page's "see why" excursion: cancels a pending queue advance. */
	cancelPendingAdvance() {
		clearTimeout(this.advanceTimeout);
		this.advanceTimeout = undefined;
	}

	private reportOnce(outcome: PracticeOutcome) {
		if (this.outcomeReported) return;
		this.outcomeReported = true;
		this.callbacks.onOutcome(outcome);
	}
}

function computeMistakeFen(fromFen: string, from: string, to: string): string | null {
	try {
		const board = new Chess(fromFen);
		board.move({ from, to, promotion: 'q' });
		return board.fen();
	} catch {
		return null;
	}
}
