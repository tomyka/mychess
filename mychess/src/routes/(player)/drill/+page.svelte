<script lang="ts">
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import type { Key } from 'chessground/types';
  import { playCorrect, playWrong, playLevelUp } from '$lib/sounds';

  let { data } = $props<{ data: any }>();

  const allMoves = $derived((data as any).drillMoves ?? []);

  let currentIdx = $state(0);
  let chain = $state(0);
  let bestChain = $state(0);
  let sessionXp = $state(0);
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
      sessionXp += 2;

      if (chain === 10) {
        playLevelUp();
        sessionXp += 50;
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
      body: JSON.stringify({ chain, sessionXp, bestChain })
    });
  }
</script>

<svelte:head>
  <title>Drill Mode — MyChess</title>
</svelte:head>

{#if data.needsAccount}
  <div class="max-w-md mx-auto text-center py-16 space-y-4">
    <h1 class="text-2xl font-bold text-gray-900">Sign in to train</h1>
    <p class="text-gray-500">Guest training is unavailable right now. Create a free account to start.</p>
    <a href="/login?signup=1" class="inline-block bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700">Get started</a>
  </div>
{:else}
<div class="min-h-screen bg-gray-50 p-4">
  <div class="max-w-3xl mx-auto">
    <div class="flex justify-between items-center mb-4">
      <a href="/" class="text-gray-400 text-sm hover:text-gray-600">← Home</a>
      <h1 class="text-xl font-bold text-gray-900">Drill Mode</h1>
      <div class="text-right">
        <div class="text-base font-bold text-indigo-600">Chain: {chain}</div>
        <div class="text-xs text-gray-400">XP: {sessionXp}</div>
      </div>
    </div>

    {#if allMoves.length === 0}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-xl text-gray-700">No mastered moves yet!</p>
        <p class="text-gray-400 mt-2">Keep mastering repertoires to unlock Drill mode.</p>
        <a href="/master"
           class="mt-4 inline-block bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-indigo-700 transition">
          Go to Master
        </a>
      </div>
    {:else if failed}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-2">😢</p>
        <h2 class="text-2xl font-bold text-red-600">Chain Broken!</h2>
        <p class="text-gray-500 mt-2">Best chain: <strong>{bestChain}</strong> moves</p>
        {#if bestChain >= 10}
          <p class="text-green-600 font-bold mt-1">+50 bonus XP for 10-chain!</p>
        {/if}
        <button onclick={restart}
                class="mt-4 w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          Try Again
        </button>
        <a href="/" class="mt-2 block text-center text-gray-400 hover:underline text-sm">Back to Home</a>
      </div>
    {:else if finished}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-2">🏆</p>
        <h2 class="text-2xl font-bold text-green-600">All Done!</h2>
        <p class="text-gray-500 mt-2">You drilled all {allMoves.length} moves!</p>
        <button onclick={restart}
                class="mt-4 w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          Go Again
        </button>
        <a href="/" class="mt-2 block text-center text-gray-400 hover:underline text-sm">Back to Home</a>
      </div>
    {:else}
      <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mb-4">
        <p class="text-center text-gray-400 text-sm mb-2">
          Move {currentIdx + 1} / {allMoves.length} · Play the correct move!
        </p>
        {#if wrongMove}
          <p class="text-center text-red-600 font-bold text-sm mb-2">Wrong move! Chain broken!</p>
        {/if}
        <ChessBoard fen={boardFen} interactable={true} onmove={handleMove} prefs={data.boardPrefs} />
      </div>

      <div class="flex gap-2 justify-center">
        <div class="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-indigo-400">Current Chain</div>
          <div class="text-2xl font-bold text-indigo-700">{chain}</div>
        </div>
        <div class="bg-green-50 border border-green-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-green-500">Best Chain</div>
          <div class="text-2xl font-bold text-green-700">{bestChain}</div>
        </div>
        <div class="bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-gray-400">Session XP</div>
          <div class="text-2xl font-bold text-gray-700">{sessionXp}</div>
        </div>
      </div>
    {/if}
  </div>
</div>
{/if}
