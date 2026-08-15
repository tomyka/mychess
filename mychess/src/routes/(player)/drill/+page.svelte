<script lang="ts">
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import type { Key } from 'chessground/types';
  import { playCorrect, playWrong, playLevelUp } from '$lib/sounds';

  let { data } = $props<{ data: any }>();

  const allMoves = $derived((data as any).drillMoves ?? []);

  let currentIdx = $state(0);
  let chain = $state(0);
  let bestChain = $state(0);
  let failed = $state(false);
  let wrongMove = $state(false);
  let finished = $state(false);

  const current = $derived(allMoves[currentIdx]);
  const boardFen = $derived(
    current?.from_position?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  );

  function handleMove(detail: { from: Key; to: Key; san: string }) {
    if (failed || finished) return;
    const targetSan = current?.san;

    if (detail.san === targetSan) {
      playCorrect();
      wrongMove = false;
      chain++;
      if (chain > bestChain) bestChain = chain;

      if (chain === 10) {
        playLevelUp();
        finished = true;
        submitDrillResult();
        return;
      }

      if (currentIdx + 1 >= allMoves.length) {
        finished = true;
        submitDrillResult();
      } else {
        currentIdx++;
      }
    } else {
      playWrong();
      wrongMove = true;
      failed = true;
      submitDrillResult();
    }
  }

  function restart() {
    currentIdx = 0;
    chain = 0;
    failed = false;
    finished = false;
    wrongMove = false;
  }

  async function submitDrillResult() {
    await fetch('/api/drill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain, bestChain })
    });
  }
</script>

<svelte:head>
  <title>Drill Mode — MyChess</title>
</svelte:head>

{#if data.needsAccount}
  <div class="max-w-md mx-auto text-center py-16 space-y-4">
    <h1 class="text-2xl font-bold text-(--color-text)">Sign in to train</h1>
    <p class="text-(--color-muted)">Guest training is unavailable right now. Create a free account to start.</p>
    <a href="/login?signup=1" class="inline-block bg-(--color-accent) text-white px-5 py-2.5 rounded-lg font-medium hover:bg-(--color-accent-hover)">Get started</a>
  </div>
{:else}
<div class="min-h-screen bg-(--color-bg) p-4">
  <div class="max-w-3xl mx-auto">
    <div class="flex justify-between items-center mb-4">
      <a href="/" class="text-(--color-muted) text-sm hover:text-(--color-text)">← Home</a>
      <h1 class="text-xl font-bold text-(--color-text)">Drill Mode</h1>
      <div class="text-right">
        <div class="text-base font-bold text-(--color-accent)">Chain: {chain}</div>
      </div>
    </div>

    {#if allMoves.length === 0}
      <div class="bg-(--color-surface) border border-(--color-border) rounded-2xl p-6 text-center shadow-sm">
        <p class="text-xl text-(--color-text)">No mastered moves yet!</p>
        <p class="text-(--color-muted) mt-2">Keep practicing repertoires to unlock Drill mode.</p>
        <a href="/practice"
           class="mt-4 inline-block bg-(--color-accent) text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-(--color-accent-hover) transition">
          Go to Practice
        </a>
      </div>
    {:else if failed}
      <div class="bg-(--color-surface) border border-(--color-border) rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-2">😢</p>
        <h2 class="text-2xl font-bold text-red-600 dark:text-red-400">Chain Broken!</h2>
        <p class="text-(--color-muted) mt-2">Best chain: <strong>{bestChain}</strong> moves</p>
        <button onclick={restart}
                class="mt-4 w-full bg-(--color-accent) text-white py-3 rounded-xl font-bold text-lg hover:bg-(--color-accent-hover) transition">
          Try Again
        </button>
        <a href="/" class="mt-2 block text-center text-(--color-muted) hover:underline text-sm">Back to Home</a>
      </div>
    {:else if finished}
      <div class="bg-(--color-surface) border border-(--color-border) rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-2">🏆</p>
        <h2 class="text-2xl font-bold text-green-600 dark:text-green-400">All Done!</h2>
        <p class="text-(--color-muted) mt-2">You drilled all {allMoves.length} moves!</p>
        <button onclick={restart}
                class="mt-4 w-full bg-(--color-accent) text-white py-3 rounded-xl font-bold text-lg hover:bg-(--color-accent-hover) transition">
          Go Again
        </button>
        <a href="/" class="mt-2 block text-center text-(--color-muted) hover:underline text-sm">Back to Home</a>
      </div>
    {:else}
      <div class="bg-(--color-surface) border border-(--color-border) rounded-2xl p-4 shadow-sm mb-4">
        <p class="text-center text-(--color-muted) text-sm mb-2">
          Move {currentIdx + 1} / {allMoves.length} · Play the correct move!
        </p>
        {#if wrongMove}
          <p class="text-center text-red-600 dark:text-red-400 font-bold text-sm mb-2">Wrong move! Chain broken!</p>
        {/if}
        <ChessBoard fen={boardFen} interactable={true} onmove={handleMove} prefs={data.boardPrefs} />
      </div>

      <div class="flex gap-2 justify-center">
        <div class="bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-indigo-400">Current Chain</div>
          <div class="text-2xl font-bold text-indigo-700">{chain}</div>
        </div>
        <div class="bg-green-50 border border-green-100 rounded-xl px-4 py-2 text-center dark:bg-green-950 dark:border-green-800">
          <div class="text-xs text-green-500 dark:text-green-400">Best Chain</div>
          <div class="text-2xl font-bold text-green-700 dark:text-green-400">{bestChain}</div>
        </div>
      </div>
    {/if}
  </div>
</div>
{/if}
