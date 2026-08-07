<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import LevelList from '$lib/components/LevelList.svelte';
	import type { Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { goto, invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { levelTag } from '$lib/mastery/tags';

	let { data } = $props<{ data: any }>();

	let quizIdx = $state(0);
	let boardFen = $state('');
	let phase = $state<'playing' | 'success' | 'leveled-up' | 'leveled-down'>('playing');
	let locked = $state(false);
	let replaying = $state(false);
	// Consecutive wrong attempts on the CURRENT quiz move — resets the moment
	// it's solved or a new attempt starts. After 3, a hint becomes available;
	// requesting it highlights the correct piece's square, never the move.
	let wrongCount = $state(0);
	let hintRequested = $state(false);
	// Whether THIS ATTEMPT (not just this move) has had any mistake yet, and
	// how many of those mistakes landed on the "previous level" review band
	// — both reset only in resetForAttempt(), and reported once when the
	// attempt finishes (see reportAttempt), not per move.
	let attemptHadMistake = $state(false);
	let attemptPrevLevelMistakes = $state(0);
	let advanceTimeout: ReturnType<typeof setTimeout> | undefined;
	// Bumped on every resetForAttempt() call so an in-flight prefix replay
	// notices it's been superseded (e.g. rapid re-navigation) and stops
	// writing to boardFen instead of racing the newer one.
	let resetToken = 0;
	// The attempt-report POST is fire-and-forget from handleMove's final move
	// (so the board never blocks on the network) — but nextAttempt must await
	// it before reloading, or invalidateAll() can race the write and re-serve
	// the same task, making Continue look like it did nothing.
	let pendingReport: Promise<unknown> | null = null;
	// Guards against a double-click/double-tap on "Continue" firing two
	// overlapping nextAttempt()/resetForAttempt() calls.
	let continuing = $state(false);

	const REPLAY_STEP_MS = 550;
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	const attempt = $derived(data.attempt);
	const repertoireId = $derived(data.repertoire?.id);
	const reviewLevel = $derived(data.reviewLevel as number | null);
	const currentTag = $derived(
		typeof data.level === 'number' ? levelTag(data.level, data.totalLevels) : levelTag(data.totalLevels, data.totalLevels)
	);

	function selectLevel(level: number) {
		goto(`/practice/${repertoireId}?level=${level}`);
	}

	function exitReview() {
		goto(`/practice/${repertoireId}`);
	}

	// The correct move's origin square — computed from the step's own
	// fromFen/san rather than stored, since only the destination is ever
	// meant to stay hidden.
	const hintSquare = $derived.by(() => {
		if (!hintRequested) return null;
		const step = attempt?.quizSteps[quizIdx];
		if (!step) return null;
		try {
			return new Chess(step.fromFen).move(step.san)?.from ?? null;
		} catch {
			return null;
		}
	});

	function advanceThroughOpponentReplies() {
		while (attempt?.quizSteps[quizIdx] && !attempt.quizSteps[quizIdx].isPlayerTurn) {
			boardFen = attempt.quizSteps[quizIdx].toFen;
			quizIdx++;
		}
	}

	// From Level 2 onward, `attempt.prefix` holds the already-mastered moves
	// leading up to this attempt's quiz. Playing them out one at a time (like
	// a PC opponent replaying the line) instead of jumping straight to the
	// quiz position mirrors how the line is actually reached in a real game,
	// reinforcing the path there rather than just the isolated position.
	async function resetForAttempt() {
		const myToken = ++resetToken;
		clearTimeout(advanceTimeout);
		quizIdx = 0;
		phase = 'playing';
		locked = false;
		replaying = false;
		wrongCount = 0;
		hintRequested = false;
		attemptHadMistake = false;
		attemptPrevLevelMistakes = 0;
		if (!attempt) return;

		if (attempt.prefix.length === 0) {
			boardFen = attempt.quizSteps[0]?.fromFen ?? '';
			advanceThroughOpponentReplies();
			return;
		}

		replaying = true;
		boardFen = attempt.prefix[0].fromFen;
		for (const step of attempt.prefix) {
			await sleep(REPLAY_STEP_MS);
			if (myToken !== resetToken) return; // superseded by a newer reset
			boardFen = step.toFen;
		}
		if (myToken !== resetToken) return;
		replaying = false;
		advanceThroughOpponentReplies();
	}

	// Set the board's initial position synchronously, before ChessBoard's own
	// onMount runs — it throws on an empty FEN, and a child's onMount fires
	// before this component's own $effect does, so waiting for the effect
	// below to set boardFen for the first time is too late.
	resetForAttempt();

	// Reset only when the REPERTOIRE itself changes (including on mount) —
	// not on every `attempt` change, since nextAttempt() below also changes
	// `attempt` via invalidateAll() and needs to decide for itself whether to
	// jump straight into the next attempt or show a level transition notice.
	$effect(() => {
		repertoireId;
		untrack(() => resetForAttempt());
	});

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (phase !== 'playing' || locked || replaying) return false;
		const currentAttempt = attempt;
		const currentReviewLevel = reviewLevel;
		const step = currentAttempt?.quizSteps[quizIdx];
		if (!step) return false;

		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			// Hold the board here so the green check is actually visible before
			// advancing — updating boardFen in the same tick would clear it
			// before the browser ever paints it.
			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				quizIdx++;
				advanceThroughOpponentReplies();
				locked = false;
				if (quizIdx >= currentAttempt.quizSteps.length) {
					phase = 'success';
					// Grading is per-attempt, not per-move — persist the whole
					// outcome the moment the last quiz step is solved. Skipped
					// during review, which is a pure read-only replay. Uses the
					// ATTEMPT/REVIEW-LEVEL CAPTURED AT THE TOP of this function,
					// not the live reactive values — the player can navigate to a
					// different level or exit review during this 500ms hold,
					// which changes `attempt`/`reviewLevel` without going through
					// resetForAttempt(), and reporting against the live (wrong)
					// attempt would corrupt an unrelated task's progress.
					if (currentReviewLevel === null) pendingReport = reportAttempt(currentAttempt);
				}
			}, 500);
			return true;
		} else {
			playWrong();
			wrongCount++;
			if (currentReviewLevel === null) {
				attemptHadMistake = true;
				if (step.band === 'previous') attemptPrevLevelMistakes++;
			}
			// Don't reveal the book move — just mark the square wrong and let
			// the player try again on the same position.
			return false;
		}
	}

	async function reportAttempt(reportedAttempt: NonNullable<typeof attempt>) {
		try {
			await fetch('/api/practice/attempt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repertoireId,
					taskKey: reportedAttempt.taskKey,
					hadMistake: attemptHadMistake,
					prevLevelMistakeCount: attemptPrevLevelMistakes
				})
			});
		} catch {
			// Report failed — the attempt itself already played out on the
			// board; just skip silently rather than blocking the player on a
			// network hiccup. Worst case: the same task is served again.
		}
	}

	function levelRank(level: number | 'mastered'): number {
		return level === 'mastered' ? Infinity : level;
	}

	async function nextAttempt() {
		const levelBefore = data.level;
		const myToken = resetToken;
		if (pendingReport) await pendingReport;
		pendingReport = null;
		await invalidateAll();
		if (myToken !== resetToken) return; // superseded by a resetForAttempt() while we were awaiting
		// `data` now reflects the fresh load. If completing that attempt
		// changed the active level — up on mastering it, or down on a
		// demotion — surface that instead of silently dropping the player
		// into the next quiz. Never applies during review: reviewing a passed
		// level can't change which level is active.
		if (reviewLevel === null && levelRank(data.level) > levelRank(levelBefore)) {
			phase = 'leveled-up';
		} else if (reviewLevel === null && levelRank(data.level) < levelRank(levelBefore)) {
			phase = 'leveled-down';
		} else {
			resetForAttempt();
		}
	}

	async function handleContinue() {
		if (continuing) return;
		continuing = true;
		try {
			if (phase === 'leveled-up' || phase === 'leveled-down') {
				resetForAttempt();
			} else {
				await nextAttempt();
			}
		} finally {
			continuing = false;
		}
	}
</script>

<svelte:head>
	<title>Practice {data.repertoire?.name ?? 'Repertoire'} — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50 p-4 max-w-5xl mx-auto pb-24">
	<div class="mb-4">
		<a href="/practice" class="text-gray-400 text-sm hover:text-gray-600">← All Repertoires</a>
	</div>

	{#if reviewLevel !== null}
		<div class="mb-4 flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 text-sm">
			<span class="text-indigo-700 font-medium">🔁 Reviewing Level {reviewLevel}</span>
			<button onclick={exitReview} class="text-indigo-600 hover:underline">Exit review</button>
		</div>
	{/if}

	{#if data.level === 'mastered' && data.totalVariations > 0 && reviewLevel === null}
		<div class="flex flex-col items-center gap-6 text-center py-16">
			<p class="text-7xl">🏆</p>
			<h1 class="text-3xl font-bold text-gray-900">Repertoire Mastered!</h1>
			<p class="text-gray-500">Every variation in {data.repertoire?.name} is fully learned.</p>
			<a
				href="/practice"
				class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition"
			>
				Back to Repertoires
			</a>
			<div class="w-full max-w-sm text-left">
				<LevelList totalLevels={data.totalLevels} currentLevel={data.level} reviewLevel={null} onselect={selectLevel} />
			</div>
		</div>
	{:else if !attempt}
		<div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
			<p class="text-5xl">📭</p>
			<h1 class="text-2xl font-bold text-gray-700">Nothing to practice</h1>
			<p class="text-gray-400">This repertoire has no moves for your color yet.</p>
			<a href="/practice" class="text-indigo-600 hover:underline">Back to Repertoires</a>
		</div>
	{:else}
		<div class="flex flex-col lg:flex-row lg:items-start gap-6">
			<div class="flex-1">
				<p class="text-center text-gray-700 font-semibold mb-4 lg:hidden">
					{replaying ? 'Watch how we got here…' : phase === 'playing' ? 'What is the best move?' : ''}
					{#if wrongCount >= 3 && !hintRequested && phase === 'playing' && !replaying}
						<button
							onclick={() => (hintRequested = true)}
							class="ml-2 inline-flex items-center gap-1 text-sm font-medium text-amber-600 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					{/if}
				</p>

				<ChessBoard
					fen={boardFen}
					interactable={phase === 'playing' && !locked && !replaying}
					onmove={handleMove}
					prefs={data.boardPrefs}
					{hintSquare}
				/>
			</div>

			<div class="w-full lg:w-72 shrink-0 space-y-4">
				<div class="p-4 bg-white border border-gray-200 rounded-2xl shadow-sm text-center">
					<p class="text-gray-400 text-sm font-medium">
						{data.repertoire?.name} · {typeof data.level === 'number' ? `Level ${data.level} of ${data.totalLevels}` : 'Mastered'} · {currentTag}
					</p>
					<p class="text-gray-400 text-sm">{data.levelSolvedCount}/{data.levelTaskCount} solved</p>
				</div>

				<LevelList
					totalLevels={data.totalLevels}
					currentLevel={data.level}
					reviewLevel={reviewLevel}
					onselect={selectLevel}
				/>

				<p class="text-center text-gray-700 font-semibold hidden lg:block">
					{replaying ? 'Watch how we got here…' : phase === 'playing' ? 'What is the best move?' : ''}
				</p>
				{#if wrongCount >= 3 && !hintRequested && phase === 'playing' && !replaying}
					<p class="text-center hidden lg:block">
						<button
							onclick={() => (hintRequested = true)}
							class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					</p>
				{/if}

				{#if phase === 'success' || phase === 'leveled-up' || phase === 'leveled-down'}
					<div class="p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
						{#if phase === 'leveled-up'}
							<p class="text-xl font-bold mb-1 text-indigo-600">🎉 Level up! Now on Level {data.level}</p>
						{:else if phase === 'leveled-down'}
							<p class="text-xl font-bold mb-1 text-amber-600">⬇️ Back to Level {data.level} — brush up and try again</p>
						{:else}
							<p class="text-xl font-bold mb-1 text-green-600">✅ Solved!</p>
						{/if}
						<button
							onclick={handleContinue}
							disabled={continuing}
							class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition disabled:opacity-50"
						>
							Continue
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</main>
