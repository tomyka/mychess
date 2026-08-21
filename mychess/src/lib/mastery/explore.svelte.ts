// mychess/src/lib/mastery/explore.svelte.ts
//
// Explore mode: the drill board going off-book for a moment. Issue #125.
//
// Kept as its own rune module rather than a pile of $state on the Learn page for
// two reasons. It is the same feature on Practice, and a second implementation
// there would drift (the lesson of epic #95's splitQueues). And the property
// that actually matters — that an excursion leaves the drill exactly as it was —
// is testable here without rendering a board: this module owns ONLY the explored
// position, never the drill's own state, so a round trip cannot touch it.
import { Chess } from 'chess.js';

export class ExploreSession {
	/** Whether the board is currently off-book. */
	active = $state(false);
	/** The explored position. Empty while inactive. */
	fen = $state('');
	/**
	 * Every position visited during THIS excursion, oldest first, the current
	 * one last — so undo is a pop and "how far off-book am I" is a length.
	 */
	history = $state<string[]>([]);
	/** Moves played during this excursion, in SAN, for the move list. */
	sans = $state<string[]>([]);

	/** How many moves deep this excursion is. */
	get depth(): number {
		return this.sans.length;
	}

	/**
	 * Enters explore mode from `fromFen` — the position the drill is currently
	 * asking about. Returns false (and stays inactive) for a FEN chess.js can't
	 * load, rather than opening a board nothing can be played on.
	 */
	start(fromFen: string): boolean {
		if (!fromFen) return false;
		try {
			new Chess(fromFen);
		} catch {
			return false;
		}
		this.active = true;
		this.fen = fromFen;
		this.history = [fromFen];
		this.sans = [];
		return true;
	}

	/**
	 * Plays a move on the explored position. Any legal move for EITHER side is
	 * accepted — trying the opponent's best answer is usually the whole reason
	 * for going off-book. Returns false for an illegal move, leaving the
	 * position untouched so the board snaps the piece back.
	 */
	play(from: string, to: string): boolean {
		if (!this.active) return false;
		const chess = new Chess(this.fen);
		try {
			// Promotion is always to a queen here: this is a scratch board for
			// answering "how does that change the evaluation", not a place to
			// study underpromotion.
			const move = chess.move({ from, to, promotion: 'q' });
			if (!move) return false;
			this.fen = chess.fen();
			this.history = [...this.history, this.fen];
			this.sans = [...this.sans, move.san];
			return true;
		} catch {
			return false;
		}
	}

	/** Steps back one explored move. A no-op at the excursion's start. */
	undo() {
		if (!this.active || this.history.length <= 1) return;
		const history = this.history.slice(0, -1);
		this.history = history;
		this.sans = this.sans.slice(0, -1);
		this.fen = history[history.length - 1];
	}

	/**
	 * Leaves explore mode. Deliberately returns nothing and takes nothing: the
	 * drill's own state was never handed over, so there is nothing to give back
	 * and no way for an excursion to have changed it.
	 */
	stop() {
		this.active = false;
		this.fen = '';
		this.history = [];
		this.sans = [];
	}
}
