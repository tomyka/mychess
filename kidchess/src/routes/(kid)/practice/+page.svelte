<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import type { Key } from 'chessground/types';

	let { data } = $props<{ data: any }>();

	const moves: any[] = (data as any).moves ?? [];

	let currentIdx = $state(0);
	let correct = $state(0);
	let incorrect = $state(0);
	let showAnswer = $state(false);
	let wrongMove = $state(false);
	let done = $state(false);

	const current = $derived(moves[currentIdx]);
	const boardFen = $derived(
		current?.from_position?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
	);

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (showAnswer) return;
		if (detail.san === current?.san) {
			wrongMove = false;
			correct++;
			showAnswer = true;
		} else {
			wrongMove = true;
			incorrect++;
		}
	}

	function reveal() {
		showAnswer = true;
	}

	function next() {
		if (currentIdx + 1 >= moves.length) {
			done = true;
		} else {
			currentIdx++;
			showAnswer = false;
			wrongMove = false;
		}
	}

	function restart() {
		currentIdx = 0;
		correct = 0;
		incorrect = 0;
		showAnswer = false;
		wrongMove = false;
		done = false;
	}
</script>

<main class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto pb-24">
	{#if moves.length === 0}
		<div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
			<p class="text-5xl">📭</p>
			<h1 class="text-2xl font-bold text-slate-300">No moves to practice</h1>
			<p class="text-slate-400">Add a repertoire first!</p>
			<a href="/" class="text-yellow-400 hover:underline">Back to Home</a>
		</div>
	{:else if done}
		<div class="flex flex-col items-center justify-center min-h-screen gap-6 text-center">
			<p class="text-7xl">🎉</p>
			<h1 class="text-4xl font-bold text-yellow-400">Practice Complete!</h1>
			<div class="bg-slate-800 rounded-2xl p-6 w-full max-w-xs space-y-3">
				<div class="flex justify-between"><span class="text-slate-400">Correct</span><span class="text-green-400 font-bold">{correct}</span></div>
				<div class="flex justify-between"><span class="text-slate-400">Incorrect</span><span class="text-red-400 font-bold">{incorrect}</span></div>
				<div class="flex justify-between"><span class="text-slate-400">Accuracy</span>
					<span class="text-yellow-400 font-bold">{Math.round((correct / moves.length) * 100)}%</span>
				</div>
			</div>
			<div class="flex gap-3">
				<button onclick={restart} class="bg-slate-700 text-white px-6 py-3 rounded-2xl font-bold hover:bg-slate-600 transition">
					Practice Again
				</button>
				<a href="/" class="bg-yellow-400 text-slate-900 px-6 py-3 rounded-2xl font-bold hover:bg-yellow-300 transition">
					Back Home
				</a>
			</div>
		</div>
	{:else}
		<div class="flex items-center justify-between mb-4">
			<a href="/" class="text-slate-400 text-sm">Home</a>
			<span class="text-slate-400 text-sm">{currentIdx + 1}/{moves.length}</span>
		</div>

		<div class="bg-slate-800 rounded-full h-2 mb-6 overflow-hidden">
			<div class="h-full bg-green-400 rounded-full transition-all duration-300" style="width: {(currentIdx / moves.length) * 100}%"></div>
		</div>

		<p class="text-center text-slate-400 text-sm font-medium mb-2">
			{current?.repertoire?.name ?? 'Practice'} · Move {currentIdx + 1}
		</p>
		<p class="text-center text-white font-semibold mb-4">
			{showAnswer ? '' : 'What is the best move?'}
		</p>

		<ChessBoard fen={boardFen} interactable={!showAnswer} onmove={handleMove} />

		{#if wrongMove && !showAnswer}
			<p class="text-red-400 text-center mt-3 font-semibold animate-pulse">Not quite! Try again...</p>
		{/if}

		{#if !showAnswer}
			<button onclick={reveal} class="mt-6 w-full bg-slate-700 py-3 rounded-xl font-semibold hover:bg-slate-600 transition">
				Show Answer
			</button>
		{:else}
			<div class="mt-6 p-5 bg-slate-800 rounded-2xl text-center">
				<p class="text-xl font-bold mb-1 text-green-400">
					{wrongMove ? 'Answer: ' + current?.san : '✅ Correct! ' + current?.san}
				</p>
				<button onclick={next} class="mt-4 w-full bg-yellow-400 text-slate-900 py-4 rounded-xl font-bold text-lg hover:bg-yellow-300 transition">
					{currentIdx + 1 < moves.length ? 'Next →' : 'Finish'}
				</button>
			</div>
		{/if}
	{/if}
</main>
