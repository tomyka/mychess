<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import type { Key } from 'chessground/types';
	import { onDestroy } from 'svelte';

	let { data } = $props<{ data: any }>();

	const moves = $derived((data as any).moves ?? []);

	// How long the ✅ correct move stays on the board before the opponent's
	// reply auto-plays (the next card's position). Wrong answers don't use this.
	const AUTO_ADVANCE_MS = 700;

	let currentIdx = $state(0);
	let correct = $state(0);
	let incorrect = $state(0);
	let showAnswer = $state(false);
	// Only true when the player must click Next themselves (wrong guess / revealed).
	// A correct move auto-advances instead of showing the button.
	let awaitingNext = $state(false);
	let wrongMove = $state(false);
	let done = $state(false);
	let advanceTimer: ReturnType<typeof setTimeout> | null = null;

	const current = $derived(moves[currentIdx]);
	const boardFen = $derived(
		current?.from_position?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
	);

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (showAnswer) return false;
		if (detail.san === current?.san) {
			wrongMove = false;
			correct++;
			showAnswer = true;
			scheduleAdvance();
			return true;
		} else {
			wrongMove = true;
			incorrect++;
			return false;
		}
	}

	function reveal() {
		showAnswer = true;
		awaitingNext = true;
	}

	function scheduleAdvance() {
		if (advanceTimer) clearTimeout(advanceTimer);
		advanceTimer = setTimeout(() => {
			advanceTimer = null;
			next();
		}, AUTO_ADVANCE_MS);
	}

	function next() {
		if (advanceTimer) {
			clearTimeout(advanceTimer);
			advanceTimer = null;
		}
		if (currentIdx + 1 >= moves.length) {
			done = true;
		} else {
			currentIdx++;
			showAnswer = false;
			awaitingNext = false;
			wrongMove = false;
		}
	}

	function restart() {
		if (advanceTimer) {
			clearTimeout(advanceTimer);
			advanceTimer = null;
		}
		currentIdx = 0;
		correct = 0;
		incorrect = 0;
		showAnswer = false;
		awaitingNext = false;
		wrongMove = false;
		done = false;
	}

	onDestroy(() => {
		if (advanceTimer) clearTimeout(advanceTimer);
	});
</script>

<svelte:head>
  <title>Practice — MyChess</title>
</svelte:head>

{#if data.needsAccount}
  <div class="max-w-md mx-auto text-center py-16 space-y-4">
    <h1 class="text-2xl font-bold text-gray-900">Sign in to train</h1>
    <p class="text-gray-500">Guest training is unavailable right now. Create a free account to start.</p>
    <a href="/login?signup=1" class="inline-block bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700">Get started</a>
  </div>
{:else}
<main class="min-h-screen bg-gray-50 p-4 max-w-lg mx-auto pb-24">
  {#if moves.length === 0}
    <div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
      <p class="text-5xl">📭</p>
      <h1 class="text-2xl font-bold text-gray-700">No moves to practice</h1>
      <p class="text-gray-400">Add a repertoire first!</p>
      <a href="/" class="text-indigo-600 hover:underline">Back to Home</a>
    </div>
  {:else if done}
    <div class="flex flex-col items-center justify-center min-h-screen gap-6 text-center">
      <p class="text-7xl">🎉</p>
      <h1 class="text-4xl font-bold text-gray-900">Practice Complete!</h1>
      <div class="bg-white border border-gray-200 rounded-2xl p-6 w-full max-w-xs space-y-3 shadow-sm">
        <div class="flex justify-between">
          <span class="text-gray-400">Correct</span>
          <span class="text-green-600 font-bold">{correct}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">Incorrect</span>
          <span class="text-red-600 font-bold">{incorrect}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">Accuracy</span>
          <span class="text-indigo-600 font-bold">{Math.round((correct / moves.length) * 100)}%</span>
        </div>
      </div>
      <div class="flex gap-3">
        <button onclick={restart}
                class="border border-gray-300 text-gray-700 px-6 py-3 rounded-2xl font-bold hover:bg-gray-50 transition">
          Practice Again
        </button>
        <a href="/" class="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-indigo-700 transition">
          Back Home
        </a>
      </div>
    </div>
  {:else}
    <div class="flex items-center justify-between mb-4">
      <a href="/" class="text-gray-400 text-sm hover:text-gray-600">Home</a>
      <span class="text-gray-400 text-sm">{currentIdx + 1}/{moves.length}</span>
    </div>

    <div class="bg-gray-200 rounded-full h-2 mb-6 overflow-hidden">
      <div class="h-full bg-green-500 rounded-full transition-all duration-300"
           style="width: {(currentIdx / moves.length) * 100}%"></div>
    </div>

    <p class="text-center text-gray-400 text-sm font-medium mb-2">
      {current?.repertoire?.name ?? 'Practice'} · Move {currentIdx + 1}
    </p>
    <p class="text-center text-gray-700 font-semibold mb-4">
      {showAnswer ? '' : 'What is the best move?'}
    </p>

    <ChessBoard fen={boardFen} interactable={!showAnswer} onmove={handleMove} />

    {#if wrongMove && !showAnswer}
      <p class="text-red-600 text-center mt-3 font-semibold animate-pulse">Not quite! Try again...</p>
    {/if}

    {#if !showAnswer}
      <button onclick={reveal}
              class="mt-6 w-full bg-white border border-gray-300 py-3 rounded-xl font-semibold hover:bg-gray-50 transition text-gray-700">
        Show Answer
      </button>
    {:else}
      <div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
        <p class="text-xl font-bold mb-1 {wrongMove ? 'text-gray-700' : 'text-green-600'}">
          {wrongMove ? 'Answer: ' + current?.san : '✅ Correct! ' + current?.san}
        </p>
        {#if awaitingNext}
          <button onclick={next}
                  class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
            {currentIdx + 1 < moves.length ? 'Next →' : 'Finish'}
          </button>
        {/if}
      </div>
    {/if}
  {/if}
</main>
{/if}
