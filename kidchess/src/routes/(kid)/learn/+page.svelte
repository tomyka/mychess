<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import { speedToRating } from '$lib/srs/fsrs';
	import { xpForReview } from '$lib/srs/xp';
	import { Rating } from 'ts-fsrs';
	import type { Key } from 'chessground/types';
	import { playCorrect, playWrong } from '$lib/sounds';

	let { data } = $props<{ data: any }>();

	// Store queue in a local variable - it won't change during the session
	const initialQueue: any[] = (data as any).queuedMoves ?? [];

	let currentIdx = $state(0);
	let phase = $state<'guess' | 'feedback'>('guess');
	let startTime = $state(Date.now());
	let sessionXp = $state(0);
	let correct = $state(0);
	let incorrect = $state(0);
	let showHint = $state(false);
	let wrongMove = $state(false);

	const current = $derived(initialQueue[currentIdx]);
	const done = $derived(currentIdx >= initialQueue.length && initialQueue.length > 0);
	const boardFen = $derived(
		current?.move?.from_position?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
	);

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (phase !== 'guess') return;
		const targetSan = current?.move?.san;
		const elapsed = Date.now() - startTime;

		if (detail.san === targetSan) {
			playCorrect();
			wrongMove = false;
			const rating = speedToRating(elapsed, false, showHint);
			const xp = xpForReview(true, showHint);
			sessionXp = Math.max(0, sessionXp + xp);
			correct++;
			phase = 'feedback';
			submitReview(rating, xp);
		} else {
			playWrong();
			wrongMove = true;
			incorrect++;
		}
	}

	function hint() { showHint = true; }

	function giveUp() {
		const xp = xpForReview(false, false);
		sessionXp = Math.max(0, sessionXp + xp);
		incorrect++;
		phase = 'feedback';
		submitReview(Rating.Again, xp);
	}

	async function submitReview(rating: Rating, xp: number) {
		const move = current?.move;
		if (!move) return;
		await fetch('/api/review', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ moveId: move.id, rating, xp })
		});
	}

	function next() {
		currentIdx++;
		phase = 'guess';
		showHint = false;
		wrongMove = false;
		startTime = Date.now();
	}
</script>

<main class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto pb-24">
	{#if done}
		<div class="flex flex-col items-center justify-center min-h-screen gap-6 text-center">
			<p class="text-7xl">🎉</p>
			<h1 class="text-4xl font-bold text-yellow-400">Session Complete!</h1>
			<div class="bg-slate-800 rounded-2xl p-6 w-full max-w-xs space-y-3">
				<div class="flex justify-between"><span class="text-slate-400">XP Earned</span><span class="text-yellow-400 font-bold">+{sessionXp}</span></div>
				<div class="flex justify-between"><span class="text-slate-400">Correct</span><span class="text-green-400 font-bold">{correct}</span></div>
				<div class="flex justify-between"><span class="text-slate-400">Incorrect</span><span class="text-red-400 font-bold">{incorrect}</span></div>
			</div>
			<a href="/" class="bg-yellow-400 text-slate-900 px-8 py-4 rounded-2xl font-bold text-lg hover:bg-yellow-300 transition">
				Back Home
			</a>
		</div>
	{:else if !current}
		<div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
			<p class="text-5xl">✅</p>
			<h1 class="text-2xl font-bold text-green-400">All caught up!</h1>
			<p class="text-slate-400">No cards due today. Come back tomorrow!</p>
			<a href="/" class="text-yellow-400 hover:underline">Back to Home</a>
		</div>
	{:else}
		<div class="flex items-center justify-between mb-4">
			<a href="/" class="text-slate-400 text-sm">Home</a>
			<div class="flex items-center gap-3">
				<span class="text-yellow-400 font-bold text-sm">+{sessionXp} XP</span>
				<span class="text-slate-400 text-sm">{currentIdx + 1}/{initialQueue.length}</span>
			</div>
		</div>

		<div class="bg-slate-800 rounded-full h-2 mb-6 overflow-hidden">
			<div class="h-full bg-yellow-400 rounded-full transition-all duration-300" style="width: {(currentIdx / initialQueue.length) * 100}%"></div>
		</div>

		<p class="text-center text-slate-400 text-sm font-medium mb-2">
			{current.move?.repertoire?.name ?? 'Repertoire'} · {current.isNew ? '🆕 New' : '🔄 Review'}
		</p>
		<p class="text-center text-white font-semibold mb-4">{phase === 'guess' ? 'What is the best move?' : ''}</p>

		<ChessBoard fen={boardFen} interactable={phase === 'guess'} onmove={handleMove} />

		{#if wrongMove && phase === 'guess'}
			<p class="text-red-400 text-center mt-3 font-semibold animate-pulse">Not quite! Try again...</p>
		{/if}

		{#if phase === 'guess'}
			<div class="flex gap-3 mt-6">
				{#if !showHint}
					<button onclick={hint} class="flex-1 bg-slate-700 py-3 rounded-xl font-semibold hover:bg-slate-600 transition">
						💡 Hint
					</button>
				{:else}
					<div class="flex-1 bg-slate-700 py-3 rounded-xl text-center text-sm text-slate-300">
						Hint: Play <strong class="text-yellow-300">{current.move?.san}</strong>
					</div>
				{/if}
				<button onclick={giveUp} class="flex-1 bg-red-900/50 py-3 rounded-xl font-semibold hover:bg-red-900/70 transition text-red-300">
					Show Answer
				</button>
			</div>
		{:else}
			<div class="mt-6 p-5 bg-slate-800 rounded-2xl text-center">
				<p class="text-2xl font-bold mb-1 text-green-400">
					{correct > 0 ? '✅ Correct!' : 'Answer: ' + (current.move?.san ?? '')}
				</p>
				<button onclick={next} class="mt-4 w-full bg-yellow-400 text-slate-900 py-4 rounded-xl font-bold text-lg hover:bg-yellow-300 transition">
					Continue →
				</button>
			</div>
		{/if}
	{/if}
</main>
