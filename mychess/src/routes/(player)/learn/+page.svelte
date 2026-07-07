<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import { speedToRating } from '$lib/srs/fsrs';
	import { xpForReview } from '$lib/srs/xp';
	import { Rating } from 'ts-fsrs';
	import type { Key } from 'chessground/types';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { Chess } from 'chess.js';
	import { evaluatePosition } from '$lib/engine/stockfish';
	import { evaluateSwing, type MoveQuality } from '$lib/engine/classify';

	let { data } = $props<{ data: any }>();

	const QUALITY_LABEL: Record<MoveQuality, string> = {
		fine: 'Also fine',
		inaccuracy: 'Inaccuracy',
		mistake: 'Mistake',
		blunder: 'Blunder'
	};
	const QUALITY_COLOR: Record<MoveQuality, string> = {
		fine: 'text-gray-500',
		inaccuracy: 'text-yellow-600',
		mistake: 'text-orange-600',
		blunder: 'text-red-600'
	};

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
	let engineLoading = $state(false);
	let engineFeedback = $state<{ swingCp: number; quality: MoveQuality } | null>(null);
	let evalRequestId = 0;

	const current = $derived(initialQueue[currentIdx]);
	const done = $derived(currentIdx >= initialQueue.length && initialQueue.length > 0);
	const boardFen = $derived(
		current?.move?.from_position?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
	);

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (phase !== 'guess') return false;
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
			return true;
		} else {
			playWrong();
			wrongMove = true;
			incorrect++;
			evaluateWrongMove(detail.san);
			return false;
		}
	}

	async function evaluateWrongMove(playedSan: string) {
		const bookSan = current?.move?.san;
		if (!bookSan) return;

		const requestId = ++evalRequestId;
		engineFeedback = null;
		engineLoading = true;
		try {
			const bookChess = new Chess(boardFen);
			bookChess.move(bookSan);
			const playedChess = new Chess(boardFen);
			playedChess.move(playedSan);

			const [bookScore, playedScore] = await Promise.all([
				evaluatePosition(bookChess.fen(), 800),
				evaluatePosition(playedChess.fen(), 800)
			]);
			if (requestId !== evalRequestId) return;
			engineFeedback = evaluateSwing(bookScore, playedScore);
		} catch {
			if (requestId === evalRequestId) engineFeedback = null;
		} finally {
			if (requestId === evalRequestId) engineLoading = false;
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
		engineLoading = false;
		engineFeedback = null;
		evalRequestId++;
		startTime = Date.now();
	}
</script>

<svelte:head>
  <title>Learn — MyChess</title>
</svelte:head>

{#if data.needsAccount}
  <div class="max-w-md mx-auto text-center py-16 space-y-4">
    <h1 class="text-2xl font-bold text-gray-900">Sign in to train</h1>
    <p class="text-gray-500">Guest training is unavailable right now. Create a free account to start.</p>
    <a href="/login?signup=1" class="inline-block bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700">Get started</a>
  </div>
{:else}
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
        {#if wrongMove}
          {#if engineLoading}
            <p class="text-sm text-gray-400 mt-2">Evaluating…</p>
          {:else if engineFeedback}
            <p class="text-sm mt-2 font-semibold {QUALITY_COLOR[engineFeedback.quality]}">
              {QUALITY_LABEL[engineFeedback.quality]}{#if engineFeedback.quality !== 'fine'} (−{engineFeedback.swingCp}cp){/if}
            </p>
          {/if}
        {/if}
        <button onclick={next}
                class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          {currentIdx + 1 < initialQueue.length ? 'Next →' : 'Finish'}
        </button>
      </div>
    {/if}
  {/if}
</main>
{/if}
