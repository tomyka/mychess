<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import VariationPicker from '$lib/components/VariationPicker.svelte';
	import type { Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { optimisticSolvedAfterAttempt, type PracticeView } from '$lib/mastery/practice';
	import type { VariationStep } from '$lib/mastery/variations';

	let { data } = $props<{ data: any }>();

	let quizIdx = $state(0);
	let boardFen = $state('');
	// 'advancing' is the brief, non-interactive gap between the final move
	// of an attempt (shown as a gold star or a red X, not a click-through
	// card) and the next attempt loading — auto-advances on its own.
	let phase = $state<'playing' | 'advancing'>('playing');
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
	// Bumped on every resetForAttempt() call so stale async work (a
	// still-in-flight report) notices it's been superseded and stops writing
	// to state.
	let resetToken = 0;
	let pendingReport: Promise<PracticeView | null> | null = null;
	let quizSteps = $state<VariationStep[]>([]);
	let pickerOpen = $state(false);

	const attempt = $derived(data.attempt);
	const repertoireId = $derived(data.repertoire?.id);

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
		if (!hintRequested) return null;
		const step = quizSteps[quizIdx];
		if (!step) return null;
		try {
			return new Chess(step.fromFen).move(step.san)?.from ?? null;
		} catch {
			return null;
		}
	});

	function resetForAttempt() {
		++resetToken;
		clearTimeout(advanceTimeout);
		quizIdx = 0;
		phase = 'playing';
		locked = false;
		wrongCount = 0;
		hintRequested = false;
		attemptHadMistake = false;
		quizSteps = attempt?.path ?? [];
		if (!attempt) return;
		boardFen = attempt.path[0]?.fromFen ?? '';
		advanceThroughOpponentReplies();
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
		untrack(() => resetForAttempt());
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
			const isFinalMove = quizIdx + 1 >= quizSteps.length;
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
				data = { ...data, solved: optimisticSolvedAfterAttempt(data, attemptHadMistake) };
			}
			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				quizIdx++;
				advanceThroughOpponentReplies();
				locked = false;
				if (quizIdx >= quizSteps.length) {
					phase = 'advancing';
					nextAttempt();
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

<main class="min-h-screen bg-gray-50 p-4 max-w-5xl mx-auto pb-24">
	<div class="mb-4 flex items-center justify-between">
		<a href="/practice" class="text-gray-400 text-sm hover:text-gray-600">← All Repertoires</a>
		{#if repertoireId}
			<button onclick={() => (pickerOpen = true)} class="text-indigo-600 text-sm font-medium hover:underline">
				Choose a variation
			</button>
		{/if}
	</div>

	{#if data.allSolved && data.total > 0}
		<div class="flex flex-col items-center gap-6 text-center py-16">
			<p class="text-7xl">🏆</p>
			<h1 class="text-3xl font-bold text-gray-900">Repertoire Solved!</h1>
			<p class="text-gray-500">Every variation in {data.repertoire?.name} has been played cleanly.</p>
			<a
				href="/practice"
				class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition"
			>
				Back to Repertoires
			</a>
			<button onclick={() => (pickerOpen = true)} class="text-indigo-600 hover:underline">
				Re-drill a specific variation
			</button>
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
					{phase === 'playing' ? 'What is the best move?' : ''}
					{#if wrongCount >= 3 && !hintRequested && phase === 'playing'}
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
					orientation={data.repertoire?.color === 'black' ? 'black' : 'white'}
					interactable={phase === 'playing' && !locked}
					onmove={handleMove}
					prefs={data.boardPrefs}
					{hintSquare}
				/>
			</div>

			<div class="w-full lg:w-72 shrink-0 space-y-4">
				<div class="p-4 bg-white border border-gray-200 rounded-2xl shadow-sm text-center">
					<p class="text-gray-400 text-sm font-medium">{data.repertoire?.name}</p>
					<p class="text-gray-900 text-lg font-bold">{data.solved} / {data.total} variations solved</p>
				</div>

				<p class="text-center text-gray-700 font-semibold hidden lg:block">
					{phase === 'playing' ? 'What is the best move?' : ''}
				</p>
				{#if wrongCount >= 3 && !hintRequested && phase === 'playing'}
					<p class="text-center hidden lg:block">
						<button
							onclick={() => (hintRequested = true)}
							class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700"
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
