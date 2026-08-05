<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import type { Key } from 'chessground/types';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';

	let { data } = $props<{ data: any }>();

	let quizIdx = $state(0);
	let boardFen = $state('');
	let phase = $state<'playing' | 'success'>('playing');
	let locked = $state(false);
	let sessionXp = $state(0);
	let advanceTimeout: ReturnType<typeof setTimeout> | undefined;

	const attempt = $derived(data.attempt);

	function advanceThroughOpponentReplies() {
		while (attempt?.quizSteps[quizIdx] && !attempt.quizSteps[quizIdx].isPlayerTurn) {
			boardFen = attempt.quizSteps[quizIdx].toFen;
			quizIdx++;
		}
	}

	function resetForAttempt() {
		clearTimeout(advanceTimeout);
		quizIdx = 0;
		phase = 'playing';
		locked = false;
		if (attempt) {
			boardFen =
				attempt.prefix.length > 0
					? attempt.prefix[attempt.prefix.length - 1].toFen
					: (attempt.quizSteps[0]?.fromFen ?? '');
			advanceThroughOpponentReplies();
		}
	}

	// Set the board's initial position synchronously, before ChessBoard's own
	// onMount runs — it throws on an empty FEN, and a child's onMount fires
	// before this component's own $effect does, so waiting for the effect
	// below to set boardFen for the first time is too late.
	resetForAttempt();

	// `attempt` must be the ONLY tracked dependency here — resetForAttempt()
	// also reads `quizIdx`, and Svelte's automatic dependency tracking would
	// otherwise subscribe this effect to it too, meaning handleMove's
	// quizIdx++ on every correct move would re-trigger a full reset. untrack()
	// prevents that.
	$effect(() => {
		attempt;
		untrack(() => resetForAttempt());
	});

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (phase !== 'playing' || locked) return false;
		const step = attempt?.quizSteps[quizIdx];
		if (!step) return false;

		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			// Grading is instant and per-move: persist + award XP for this exact
			// move the moment it's played, independent of whether the rest of the
			// attempt succeeds.
			submitMoveProgress(step.moveId);
			// Hold the board here so the green check is actually visible before
			// advancing — updating boardFen in the same tick would clear it
			// before the browser ever paints it.
			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				quizIdx++;
				advanceThroughOpponentReplies();
				locked = false;
				if (quizIdx >= attempt.quizSteps.length) {
					phase = 'success';
				}
			}, 500);
			return true;
		} else {
			playWrong();
			// Don't reveal the book move — just mark the square wrong and let
			// the player try again on the same position.
			return false;
		}
	}

	async function submitMoveProgress(moveId: string) {
		try {
			const res = await fetch('/api/practice/move-progress', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ moveId })
			});
			const result = await res.json();
			sessionXp += result.xpAwarded ?? 0;
		} catch {
			// Progress submission failed — the move itself already played
			// correctly on the board; just skip the XP bump silently rather than
			// blocking the player on a network hiccup.
		}
	}

	async function nextAttempt() {
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>Practice {data.repertoire?.name ?? 'Repertoire'} — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50 p-4 max-w-3xl mx-auto pb-24">
	<div class="flex items-center justify-between mb-4">
		<a href="/practice" class="text-gray-400 text-sm hover:text-gray-600">← All Repertoires</a>
		<span class="text-indigo-600 font-bold text-sm">+{sessionXp} XP</span>
	</div>

	{#if data.level === 'mastered' && data.totalVariations > 0}
		<div class="flex flex-col items-center justify-center min-h-screen gap-6 text-center">
			<p class="text-7xl">🏆</p>
			<h1 class="text-3xl font-bold text-gray-900">Repertoire Mastered!</h1>
			<p class="text-gray-500">Every variation in {data.repertoire?.name} is fully learned.</p>
			<a
				href="/practice"
				class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition"
			>
				Back to Repertoires
			</a>
		</div>
	{:else if !attempt}
		<div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
			<p class="text-5xl">📭</p>
			<h1 class="text-2xl font-bold text-gray-700">Nothing to practice</h1>
			<p class="text-gray-400">This repertoire has no moves for your color yet.</p>
			<a href="/practice" class="text-indigo-600 hover:underline">Back to Repertoires</a>
		</div>
	{:else}
		<p class="text-center text-gray-400 text-sm font-medium mb-2">
			{data.repertoire?.name} · Level {data.level} · {data.satisfiedCount}/{data.totalVariations} solved
		</p>
		<p class="text-center text-gray-700 font-semibold mb-4">
			{phase === 'playing' ? 'What is the best move?' : ''}
		</p>

		<ChessBoard
			fen={boardFen}
			interactable={phase === 'playing' && !locked}
			onmove={handleMove}
			prefs={data.boardPrefs}
		/>

		{#if phase === 'success'}
			<div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
				<p class="text-xl font-bold mb-1 text-green-600">✅ Solved!</p>
				<button
					onclick={nextAttempt}
					class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition"
				>
					Continue
				</button>
			</div>
		{/if}
	{/if}
</main>
