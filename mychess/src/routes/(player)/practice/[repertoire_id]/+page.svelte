<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import VariationPicker from '$lib/components/VariationPicker.svelte';
	import type { Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { optimisticSolvedAfterAttempt, type PracticeView } from '$lib/mastery/practice';
	import { arrowMoveForStep, isLastPlayerMove } from '$lib/mastery/teaching';
	import { moveSequenceLabel, type VariationStep } from '$lib/mastery/variations';
	import EngineEval from '$lib/components/EngineEval.svelte';

	let { data } = $props<{ data: any }>();

	let quizIdx = $state(0);
	let boardFen = $state('');
	// 'advancing' is the brief, non-interactive gap between the final move
	// of an attempt (shown as a gold star or a red X, not a click-through
	// card) and the next attempt loading — auto-advances on its own.
	// 'autoplay' is the intro before a teach pass: already-mastered earlier
	// batches play themselves out so the player only has to actually play
	// the batch currently being taught — see startAutoPlay().
	// 'transition' is the beat AFTER a clean teach pass and BEFORE the board
	// snaps back for its blind retest, held open just long enough to read the
	// "now play it from memory" cue — see showTeachCue().
	let phase = $state<'playing' | 'advancing' | 'autoplay' | 'transition'>('playing');
	let locked = $state(false);
	// Consecutive wrong attempts on the CURRENT quiz move — resets the moment
	// it's solved or a new attempt starts. After 3, a hint becomes available;
	// requesting it highlights the correct piece's square, never the move.
	let wrongCount = $state(0);
	let hintRequested = $state(false);
	// Whether THIS ATTEMPT (the whole variation replay) has had any mistake
	// yet — a clean full replay is what marks a variation solved. Reset only
	// in resetForAttempt().
	let attemptHadMistake = $state(false);
	let advanceTimeout: ReturnType<typeof setTimeout> | undefined;
	let autoPlayTimeout: ReturnType<typeof setTimeout> | undefined;
	// Whether the "now play it from memory" cue is currently up. A clean teach
	// pass is followed by a blind retest of the very same moves, which used to
	// look like the board silently rewinding itself for no reason — the cue is
	// what makes that reset read as the intentional test it is.
	let teachCue = $state(false);
	let cueTimeout: ReturnType<typeof setTimeout> | undefined;
	// How long the finished teach pass is held on screen before the board
	// resets (long enough to read the cue, short enough not to feel like a
	// stall), and how much longer the cue then lingers OVER the freshly reset
	// board — the reset itself is the moment being explained, so the cue has
	// to outlive it rather than vanish with it.
	const CUE_HOLD_MS = 1200;
	const CUE_LINGER_MS = 1800;
	// How long each already-mastered ply is shown before advancing to the
	// next one during the autoplay intro — fast enough not to be tedious for
	// a long, deeply-nested variation, slow enough to still read as "playing
	// through", not an instant jump-cut.
	const AUTO_PLAY_STEP_MS = 350;
	// Bumped on every resetForAttempt() call so stale async work (a
	// still-in-flight report) notices it's been superseded and stops writing
	// to state.
	let resetToken = 0;
	let pendingReport: Promise<PracticeView | null> | null = null;
	let quizSteps = $state<VariationStep[]>([]);
	let pickerOpen = $state(false);
	// The board's own actual rendered width (bound from ChessBoard) — the
	// move-nav row below it is capped to match, since on desktop the board
	// is height-constrained (containerFit) and often narrower than its
	// column, so a plain full-width row would otherwise end up wider than
	// the board itself.
	let boardWidth = $state(0);
	// null means "following the live position" (quizIdx) — set to a concrete
	// ply count while the player is browsing back through THIS attempt's
	// already-played moves with the mobile move-nav row. Review-only: it
	// never lets the player look past quizIdx (nothing further has been
	// played yet), and the board is non-interactable while it's non-null —
	// stepping back doesn't undo anything, it's just a look back.
	let manualReviewIdx = $state<number | null>(null);

	const attempt = $derived(data.attempt);
	const repertoireId = $derived(data.repertoire?.id);
	const reviewIdx = $derived(manualReviewIdx ?? quizIdx);
	const isReviewing = $derived(manualReviewIdx !== null);

	/** The board position after `plyCount` plies of quizSteps have been played (0 = the attempt's start). */
	function positionAt(plyCount: number): string {
		if (plyCount <= 0) return quizSteps[0]?.fromFen ?? boardFen;
		return quizSteps[plyCount - 1]?.toFen ?? boardFen;
	}

	// boardFen is used at the live position rather than positionAt(quizIdx) —
	// the two always agree, but boardFen is what the 500ms correct-move hold
	// (see handleMove) intentionally delays updating, so deriving from it
	// keeps that timing intact instead of jumping the board early.
	const displayFen = $derived(isReviewing ? positionAt(reviewIdx) : boardFen);

	// Plain-text move list for the mobile eval panel (Lichess-style), e.g.
	// "1.e4 e5 2.Nf3 Nc6" — every move actually played so far in this
	// attempt, independent of manualReviewIdx (browsing back to look at an
	// earlier position doesn't shrink the list).
	const movesSoFar = $derived(quizIdx > 0 ? moveSequenceLabel(quizSteps.slice(0, quizIdx)) : '');

	function reviewToStart() {
		manualReviewIdx = 0;
	}
	function reviewBack() {
		manualReviewIdx = Math.max(0, reviewIdx - 1);
	}
	function reviewForward() {
		const next = Math.min(quizIdx, reviewIdx + 1);
		manualReviewIdx = next >= quizIdx ? null : next;
	}
	function reviewToLive() {
		manualReviewIdx = null;
	}

	// Left/Right step one ply of review at a time; Up/Down jump to the
	// start/live-end of the current attempt — mirrors the ⏮◀▶⏭ buttons
	// exactly. Ignored while the variation picker is open (it doesn't use
	// arrow keys itself, but the board underneath shouldn't react while a
	// modal is up) or when there's nothing loaded to review.
	function handleKeydown(e: KeyboardEvent) {
		if (pickerOpen || !attempt) return;
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			reviewBack();
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			reviewForward();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			reviewToStart();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			reviewToLive();
		}
	}

	function advanceThroughOpponentReplies() {
		while (quizSteps[quizIdx] && !quizSteps[quizIdx].isPlayerTurn) {
			boardFen = quizSteps[quizIdx].toFen;
			quizIdx++;
		}
	}

	// The correct move's origin square — computed from the step's own
	// fromFen/san rather than stored, since only the destination is ever
	// meant to stay hidden.
	const hintSquare = $derived.by(() => {
		if (!hintRequested || isReviewing) return null;
		const step = quizSteps[quizIdx];
		if (!step) return null;
		try {
			return new Chess(step.fromFen).move(step.san)?.from ?? null;
		} catch {
			return null;
		}
	});

	// The current ply's teaching arrow, if this attempt is a teach pass and
	// we're standing on one of its plies — see arrowMoveForStep for the
	// player-turn/ply-range/parse-failure guards. Suppressed while reviewing
	// an earlier position: the arrow points at the move due at the LIVE ply,
	// which would land on the wrong square (or no piece at all) if drawn over
	// a past position instead.
	const arrowMove = $derived.by(() => {
		if (isReviewing) return null;
		const step = quizSteps[quizIdx];
		if (!step) return null;
		const move = arrowMoveForStep(step, quizIdx, attempt?.arrowPlies ?? null);
		return move ? { from: move.from as Key, to: move.to as Key } : null;
	});

	/**
	 * Raises the between-passes cue and keeps it up across the board reset that
	 * follows. Its timeout is deliberately NOT cleared by resetForAttempt() —
	 * every other bit of attempt state is per-attempt, but this one exists
	 * precisely to bridge two attempts, so tying its lifetime to the reset
	 * would hide it at exactly the moment it's needed. It's cleared only by a
	 * player-initiated jump elsewhere (variation switch / repertoire change),
	 * where the cue would be talking about a line they just left.
	 */
	function showTeachCue() {
		clearTimeout(cueTimeout);
		teachCue = true;
		cueTimeout = setTimeout(() => (teachCue = false), CUE_HOLD_MS + CUE_LINGER_MS);
	}

	function clearTeachCue() {
		clearTimeout(cueTimeout);
		teachCue = false;
	}

	function resetForAttempt() {
		++resetToken;
		clearTimeout(advanceTimeout);
		clearTimeout(autoPlayTimeout);
		quizIdx = 0;
		manualReviewIdx = null;
		phase = 'playing';
		locked = false;
		wrongCount = 0;
		hintRequested = false;
		attemptHadMistake = false;
		quizSteps = attempt?.path ?? [];
		if (!attempt) return;
		boardFen = attempt.path[0]?.fromFen ?? '';
		// autoPlayThrough covers whatever's already mastered — either by THIS
		// variation's own earlier progress, or by a SIBLING variation sharing
		// the same leading moves (see computeMasteredMoveIds) — so it applies
		// during a blind retest too, not just a teach pass: content that's
		// genuinely already known plays itself out instead of making the
		// player re-enter it by hand every time a variation happens to share
		// it. 0 for an already-solved variation's own re-drill, where full
		// manual replay is the point.
		const autoPlayTarget = attempt.autoPlayThrough ?? 0;
		if (autoPlayTarget > 0) {
			phase = 'autoplay';
			autoPlayStep(resetToken, autoPlayTarget);
		} else {
			advanceThroughOpponentReplies();
		}
	}

	function autoPlayStep(myToken: number, target: number) {
		if (myToken !== resetToken) return; // superseded by a later resetForAttempt()
		if (quizIdx >= target) {
			phase = 'playing';
			advanceThroughOpponentReplies();
			return;
		}
		boardFen = quizSteps[quizIdx].toFen;
		quizIdx++;
		autoPlayTimeout = setTimeout(() => autoPlayStep(myToken, target), AUTO_PLAY_STEP_MS);
	}

	// Set the board's initial position synchronously, before ChessBoard's own
	// onMount runs — it throws on an empty FEN.
	resetForAttempt();

	// Reset when the REPERTOIRE changes (including on mount) — not on every
	// `attempt` change, since nextAttempt() below also changes `attempt` via
	// invalidateAll()/a merged report and calls resetForAttempt() itself once
	// it's ready.
	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- deliberate Svelte dependency-tracking read
		repertoireId;
		untrack(() => {
			clearTeachCue();
			resetForAttempt();
		});
	});

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (phase !== 'playing' || locked) return false;
		const step = quizSteps[quizIdx];
		if (!step) return false;

		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			logMove(step.moveId, detail.san, true);
			// NOT quizIdx + 1 >= quizSteps.length — a served path can end with a
			// trailing opponent-only run (the variation's true leaf is the
			// opponent's reply), so the LAST PLAYER move isn't always the path's
			// last ply. See isLastPlayerMove's doc comment.
			const isFinalMove = isLastPlayerMove(quizSteps, quizIdx);
			// Fire the completion report NOW, before the hold below, not
			// after — the report's network round trip then overlaps with the
			// 500ms hold instead of stacking after it.
			if (isFinalMove && attempt) {
				pendingReport = reportAttempt(attempt.variationKey, attemptHadMistake);
				// Bump the sidebar count immediately rather than waiting for
				// the round trip above to resolve — it re-walks the whole
				// repertoire's move tree to advance the active variation,
				// which can take a real, noticeable moment for a large
				// repertoire. nextAttempt() overwrites this with the
				// server's authoritative value once pendingReport resolves.
				// Only a FINAL pass can actually solve the variation — a
				// clean teach or intermediate blind-retest pass hasn't, so it
				// must not bump the count.
				if (attempt.isFinalPass) {
					data = { ...data, solved: optimisticSolvedAfterAttempt(data, attemptHadMistake) };
				}
			}
			// A clean teach pass is about to be re-served as a blind retest of
			// the same moves: same length, same start, arrows gone. Announce
			// that BEFORE the reset, or it just looks like the board threw the
			// player's work away and started over (issue #68). A final pass
			// (which solves the variation) and a pass with a mistake in it
			// (which re-serves the identical teach pass, arrows and all) both
			// mean something else, so neither gets this cue.
			const cueRetest = isFinalMove && !attemptHadMistake && !!attempt?.arrowPlies && !attempt.isFinalPass;
			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				quizIdx++;
				advanceThroughOpponentReplies();
				locked = false;
				if (quizIdx >= quizSteps.length) {
					if (cueRetest) {
						showTeachCue();
						phase = 'transition';
						advanceTimeout = setTimeout(() => {
							phase = 'advancing';
							nextAttempt();
						}, CUE_HOLD_MS);
					} else {
						phase = 'advancing';
						nextAttempt();
					}
				}
			}, 500);
			return isFinalMove ? 'final' : true;
		}

		playWrong();
		wrongCount++;
		attemptHadMistake = true;
		logMove(step.moveId, detail.san, false);
		// Don't reveal the book move — just mark the square wrong and let
		// the player try again on the same position. The whole attempt is
		// no longer clean, but they still finish playing it out.
		return false;
	}

	async function reportAttempt(variationKey: string, hadMistake: boolean): Promise<PracticeView | null> {
		try {
			const res = await fetch('/api/practice/attempt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId, variationKey, hadMistake })
			});
			if (!res.ok) return null;
			return await res.json();
		} catch {
			return null;
		}
	}

	function logMove(moveId: string, playedSan: string, isCorrect: boolean) {
		fetch('/api/practice/move-log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ repertoireId, moveId, playedSan, isCorrect })
		}).catch(() => {});
	}

	async function nextAttempt() {
		const myToken = resetToken;
		const view = pendingReport ? await pendingReport : null;
		pendingReport = null;
		if (myToken !== resetToken) return; // superseded by a resetForAttempt() while we were awaiting

		if (view) {
			data = { ...data, ...view };
		} else {
			await invalidateAll();
			if (myToken !== resetToken) return;
		}
		resetForAttempt();
	}

	async function selectVariation(variationKey: string) {
		pickerOpen = false;
		clearTeachCue();
		const res = await fetch('/api/practice/select-variation', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ repertoireId, variationKey })
		});
		if (res.ok) {
			data = { ...data, ...(await res.json()) };
			resetForAttempt();
		}
	}
</script>

<svelte:head>
	<title>Practice {data.repertoire?.name ?? 'Repertoire'} — MyChess</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<main
	class="min-h-screen lg:min-h-0 lg:h-[calc(100vh-4rem)] lg:overflow-hidden bg-(--color-bg) p-4 max-w-7xl mx-auto pb-24 lg:pb-4 flex flex-col"
	data-phase={phase}
>
	<div class="mb-3 flex items-center justify-between gap-3 shrink-0">
		<a href="/practice" class="text-(--color-muted) text-sm hover:text-(--color-text) shrink-0">← All Repertoires</a>
		{#if data.repertoire?.name}
			<h1 class="text-(--color-text) font-bold text-base sm:text-lg truncate text-center flex-1 min-w-0">
				{data.repertoire.name}
			</h1>
		{/if}
		{#if repertoireId}
			<button
				onclick={() => (pickerOpen = true)}
				class="lg:hidden inline-flex items-center gap-1 text-(--color-accent) text-sm font-medium hover:underline shrink-0"
			>
				<span aria-hidden="true">📖</span> Switch variation
			</button>
		{/if}
	</div>

	<!-- `!attempt` is load-bearing: re-drilling from the solved screen keeps
	     `allSolved` true (picking a variation deliberately doesn't un-solve
	     anything), and the server signals the re-drill by returning a real
	     `attempt` anyway — `/api/practice/select-variation` passes
	     `forceAttempt: true`, which makes `buildPracticeView` build an attempt
	     despite the repertoire being complete. Without this guard the solved
	     screen kept winning the branch, so "Re-drill a specific variation"
	     closed the picker and appeared to do nothing. -->
	{#if data.allSolved && data.total > 0 && !attempt}
		<div class="flex flex-col items-center gap-6 text-center py-16">
			<p class="text-7xl">🏆</p>
			<h2 class="text-3xl font-bold text-(--color-text)">Repertoire Solved!</h2>
			<p class="text-(--color-muted)">Every variation in {data.repertoire?.name} has been played cleanly.</p>
			<a
				href="/practice"
				class="bg-(--color-accent) text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-(--color-accent-hover) transition"
			>
				Back to Repertoires
			</a>
			<button onclick={() => (pickerOpen = true)} class="text-(--color-accent) hover:underline">
				Re-drill a specific variation
			</button>
		</div>
	{:else if !attempt}
		<div class="flex flex-col items-center justify-center min-h-screen lg:min-h-0 lg:flex-1 text-center gap-4">
			<p class="text-5xl">📭</p>
			<h2 class="text-2xl font-bold text-(--color-text)">Nothing to practice</h2>
			<p class="text-(--color-muted)">This repertoire has no moves for your color yet.</p>
			<a href="/practice" class="text-(--color-accent) hover:underline">Back to Repertoires</a>
		</div>
	{:else}
		<div class="p-3 bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm text-center mb-3 shrink-0 lg:hidden">
			<p class="text-sm font-bold text-(--color-text)">{data.solved} / {data.total} variations solved</p>
		</div>

		<div class="flex flex-col lg:flex-row lg:items-stretch gap-6 lg:flex-1 lg:min-h-0">
			<div class="lg:flex-1 lg:flex lg:flex-col lg:min-h-0">
				<!-- Sits directly above the board in both layouts, so it's in the
				     same place the player is already looking. role="status" (an
				     implicit aria-live="polite" region) announces it on appearance:
				     it's the only signal that the board is about to rewind, and
				     nothing about the board itself conveys that. -->
				{#if teachCue}
					<p
						role="status"
						class="mb-3 shrink-0 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-center text-sm font-semibold text-amber-800 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
					>
						<span aria-hidden="true">🧠</span> Nice — now play it from memory
					</p>
				{/if}

				{#if wrongCount >= 3 && !hintRequested && phase === 'playing'}
					<p class="text-center mb-4 lg:hidden">
						<button
							onclick={() => (hintRequested = true)}
							class="inline-flex items-center gap-1 text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					</p>
				{/if}

				<div class="lg:flex-1 lg:min-h-0 lg:flex lg:items-start lg:justify-center lg:[container-type:size]">
					<ChessBoard
						fen={displayFen}
						orientation={data.repertoire?.color === 'black' ? 'black' : 'white'}
						interactable={phase === 'playing' && !locked && !isReviewing}
						onmove={handleMove}
						prefs={data.boardPrefs}
						{hintSquare}
						{arrowMove}
						containerFit
						bind:boxWidth={boardWidth}
					/>
				</div>

				<div
					class="grid grid-cols-5 gap-2 mt-4 shrink-0 mx-auto w-full items-center"
					style={boardWidth ? `max-width: ${boardWidth}px` : ''}
				>
					<button
						onclick={reviewToStart}
						disabled={reviewIdx <= 0}
						aria-label="Jump to start"
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-text) disabled:opacity-30 disabled:cursor-not-allowed hover:bg-(--color-border)/40"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
							<rect x="4" y="4" width="1.6" height="12" />
							<path d="M14.5 4l-6 6 6 6V4z" />
						</svg>
					</button>
					<button
						onclick={reviewBack}
						disabled={reviewIdx <= 0}
						aria-label="Move back"
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-text) disabled:opacity-30 disabled:cursor-not-allowed hover:bg-(--color-border)/40"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
							<path d="M12.5 4l-6 6 6 6V4z" />
						</svg>
					</button>
					<p class="text-center text-sm font-semibold text-(--color-muted) tabular-nums" aria-hidden="true">
						{reviewIdx} / {quizSteps.length}
					</p>
					<button
						onclick={reviewForward}
						disabled={!isReviewing}
						aria-label="Move forward"
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-text) disabled:opacity-30 disabled:cursor-not-allowed hover:bg-(--color-border)/40"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
							<path d="M7.5 4l6 6-6 6V4z" />
						</svg>
					</button>
					<button
						onclick={reviewToLive}
						disabled={!isReviewing}
						aria-label="Jump to current position"
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-text) disabled:opacity-30 disabled:cursor-not-allowed hover:bg-(--color-border)/40"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
							<rect x="14.4" y="4" width="1.6" height="12" />
							<path d="M5.5 4l6 6-6 6V4z" />
						</svg>
					</button>
				</div>

				<div class="mt-3 p-3 bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm lg:hidden">
					<EngineEval fen={displayFen} />
					{#if movesSoFar}
						<p class="text-sm text-(--color-muted) mt-2">{movesSoFar}</p>
					{/if}
				</div>
			</div>

			<div
				class="w-full lg:w-80 lg:shrink-0 hidden lg:flex lg:flex-col divide-y divide-(--color-border) bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm lg:overflow-y-auto"
			>
				<div class="p-4">
					<div class="flex items-center justify-between gap-2">
						<span class="text-(--color-muted) text-sm">{data.solved} / {data.total} variations solved</span>
						<button
							onclick={() => (pickerOpen = true)}
							class="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-(--color-accent) border border-(--color-border) rounded-lg px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800"
						>
							<span aria-hidden="true">📖</span> Switch
						</button>
					</div>
					<div class="h-1.5 rounded-full bg-gray-200 overflow-hidden mt-2">
						<div
							class="h-full bg-(--color-accent) rounded-full"
							style={`width: ${data.total ? (data.solved / data.total) * 100 : 0}%`}
						></div>
					</div>
				</div>

				<div class="p-4">
					<EngineEval fen={displayFen} />
				</div>

				<div class="p-4 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted) mb-2">Moves played</p>
					<p class="text-sm text-(--color-muted)">{movesSoFar || '—'}</p>
				</div>

				{#if wrongCount >= 3 && !hintRequested && phase === 'playing'}
					<p class="text-center p-4">
						<button
							onclick={() => (hintRequested = true)}
							class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					</p>
				{/if}
			</div>
		</div>
	{/if}

	{#if pickerOpen && repertoireId}
		<VariationPicker {repertoireId} onselect={selectVariation} onclose={() => (pickerOpen = false)} />
	{/if}
</main>
