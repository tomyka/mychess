<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import { speedToRating } from '$lib/srs/fsrs';
	import { xpForReview } from '$lib/srs/xp';
	import { Rating } from 'ts-fsrs';
	import type { Key } from 'chessground/types';
	import { playCorrect, playWrong } from '$lib/sounds';

	let { data } = $props<{ data: any }>();

	// Store queue in a local variable - it won't change during the session
	const initialQueue = $derived((data as any).queuedMoves ?? []);

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

<svelte:head>
  <title>Learn — mychess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50 p-4 max-w-lg mx-auto pb-24">
  {#if done}
    <div class="flex flex-col items-center justify-center min-h-screen gap-6 text-center">
      <p class="text-7xl">🎉</p>
      <h1 class="text-4xl font-bold text-gray-900">Session Complete!</h1>
      <div class="bg-white border border-gray-200 rounded-2xl p-6 w-full max-w-xs space-y-3 shadow-sm">
        <div class="flex justify-between">
          <span class="text-gray-400">XP Earned</span>
          <span class="text-indigo-600 font-bold">+{sessionXp}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">Correct</span>
          <span class="text-green-600 font-bold">{correct}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">Incorrect</span>
          <span class="text-red-600 font-bold">{incorrect}</span>
        </div>
      </div>
      <a href="/" class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition">
        Back Home
      </a>
    </div>

  {:else if !current}
    <div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
      <p class="text-5xl">✅</p>
      <h1 class="text-2xl font-bold text-green-600">All caught up!</h1>
      <p class="text-gray-400">No cards due today. Come back tomorrow!</p>
      <a href="/" class="text-indigo-600 hover:underline">Back to Home</a>
    </div>

  {:else}
    <div class="flex items-center justify-between mb-4">
      <a href="/" class="text-gray-400 text-sm hover:text-gray-600">Home</a>
      <div class="flex items-center gap-3">
        <span class="text-indigo-600 font-bold text-sm">+{sessionXp} XP</span>
        <span class="text-gray-400 text-sm">{currentIdx + 1}/{initialQueue.length}</span>
      </div>
    </div>

    <div class="bg-gray-200 rounded-full h-2 mb-6 overflow-hidden">
      <div class="h-full bg-indigo-500 rounded-full transition-all duration-300"
           style="width: {(currentIdx / initialQueue.length) * 100}%"></div>
    </div>

    <p class="text-center text-gray-400 text-sm font-medium mb-2">
      {current.move?.repertoire?.name ?? 'Repertoire'} · {current.isNew ? '🆕 New' : '🔄 Review'}
    </p>
    <p class="text-center text-gray-700 font-semibold mb-4">{phase === 'guess' ? 'What is the best move?' : ''}</p>

    <ChessBoard fen={boardFen} interactable={phase === 'guess'} onmove={handleMove} />

    {#if wrongMove && phase === 'guess'}
      <p class="text-red-600 text-center mt-3 font-semibold animate-pulse">Not quite! Try again...</p>
    {/if}

    {#if phase === 'guess'}
      <div class="flex gap-3 mt-6">
        {#if !showHint}
          <button onclick={hint}
                  class="flex-1 bg-white border border-gray-300 py-3 rounded-xl font-semibold hover:bg-gray-50 transition text-gray-700">
            💡 Hint
          </button>
        {:else}
          <div class="flex-1 bg-gray-50 border border-gray-200 py-3 rounded-xl text-center text-sm text-gray-500">
            Hint: Play <strong class="text-indigo-600">{current.move?.san}</strong>
          </div>
        {/if}
        <button onclick={giveUp}
                class="flex-1 bg-red-50 border border-red-200 py-3 rounded-xl font-semibold hover:bg-red-100 transition text-red-600">
          Show Answer
        </button>
      </div>
    {:else}
      <div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
        <p class="text-xl font-bold mb-1 {wrongMove ? 'text-gray-700' : 'text-green-600'}">
          {wrongMove ? 'Answer: ' + current.move?.san : '✅ Correct! ' + current.move?.san}
        </p>
        <button onclick={next}
                class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          {currentIdx + 1 < initialQueue.length ? 'Next →' : 'Finish'}
        </button>
      </div>
    {/if}
  {/if}
</main>
