<script lang="ts">
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import SirKnight from '$lib/components/SirKnight.svelte';
  import type { Key } from 'chessground/types';
  import { playCorrect, playWrong, playLevelUp } from '$lib/sounds';

  let { data } = $props<{ data: any }>();

  const allMoves: any[] = (data as any).drillMoves ?? [];

  let currentIdx = $state(0);
  let chain = $state(0);
  let bestChain = $state(0);
  let sessionXp = $state(0);
  let failed = $state(false);
  let wrongMove = $state(false);
  let finished = $state(false);
  let mood = $state<'idle' | 'cheer' | 'sad' | 'surprise' | 'sleepy' | 'party'>('idle');

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
      mood = 'cheer';
      setTimeout(() => { mood = 'idle'; }, 800);

      if (chain === 10) {
        playLevelUp();
        sessionXp += 50;
        mood = 'party';
      }

      if (currentIdx + 1 >= allMoves.length) {
        finished = true;
        mood = 'party';
        submitDrillResult();
      } else {
        currentIdx++;
      }
    } else {
      playWrong();
      wrongMove = true;
      failed = true;
      mood = 'sad';
      submitDrillResult();
    }
  }

  function restart() {
    currentIdx = 0;
    chain = 0;
    failed = false;
    finished = false;
    wrongMove = false;
    mood = 'idle';
  }

  async function submitDrillResult() {
    await fetch('/api/drill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain, sessionXp, bestChain })
    });
  }
</script>

<div class="min-h-screen bg-gradient-to-b from-amber-50 to-yellow-100 p-4">
  <div class="max-w-lg mx-auto">
    <!-- Header -->
    <div class="flex justify-between items-center mb-4">
      <a href="/" class="text-2xl">⬅️</a>
      <h1 class="text-2xl font-bold text-amber-800">⚡ Drill Mode</h1>
      <div class="text-right">
        <div class="text-lg font-bold text-amber-600">Chain: {chain}</div>
        <div class="text-sm text-amber-500">XP: {sessionXp}</div>
      </div>
    </div>

    <SirKnight {mood} />

    {#if allMoves.length === 0}
      <div class="bg-white rounded-2xl p-6 text-center shadow">
        <p class="text-xl">🎓 No mastered moves yet!</p>
        <p class="text-gray-500 mt-2">Keep reviewing in Learn mode to unlock Drill mode.</p>
        <a href="/learn" class="mt-4 block btn-primary">Go to Learn</a>
      </div>
    {:else if failed}
      <div class="bg-white rounded-2xl p-6 text-center shadow">
        <p class="text-4xl mb-2">😢</p>
        <h2 class="text-2xl font-bold text-red-600">Chain Broken!</h2>
        <p class="text-gray-600 mt-2">Best chain: <strong>{bestChain}</strong> moves</p>
        <p class="text-amber-600 font-bold mt-1">+{sessionXp} XP earned</p>
        {#if bestChain >= 10}
          <p class="text-green-600 font-bold mt-1">+50 bonus XP for 10-chain!</p>
        {/if}
        <button onclick={restart} class="mt-4 w-full bg-amber-500 text-white py-3 rounded-xl font-bold text-lg hover:bg-amber-600 transition">
          Try Again 🔄
        </button>
        <a href="/" class="mt-2 block text-center text-gray-500 hover:underline">Back to Home</a>
      </div>
    {:else if finished}
      <div class="bg-white rounded-2xl p-6 text-center shadow">
        <p class="text-4xl mb-2">🏆</p>
        <h2 class="text-2xl font-bold text-green-600">All Done!</h2>
        <p class="text-gray-600 mt-2">You drilled all {allMoves.length} moves!</p>
        <p class="text-amber-600 font-bold mt-1">+{sessionXp} XP earned</p>
        <button onclick={restart} class="mt-4 w-full bg-amber-500 text-white py-3 rounded-xl font-bold text-lg hover:bg-amber-600 transition">
          Go Again 🔄
        </button>
        <a href="/" class="mt-2 block text-center text-gray-500 hover:underline">Back to Home</a>
      </div>
    {:else}
      <div class="bg-white rounded-2xl p-4 shadow mb-4">
        <p class="text-center text-gray-500 text-sm mb-2">
          Move {currentIdx + 1} / {allMoves.length} &bull; Play the correct move!
        </p>
        {#if wrongMove}
          <p class="text-center text-red-500 font-bold text-sm mb-2">❌ Wrong move! Chain broken!</p>
        {/if}
        <ChessBoard fen={boardFen} interactable={true} onmove={handleMove} />
      </div>

      <div class="flex gap-2 justify-center">
        <div class="bg-amber-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-amber-600">Current Chain</div>
          <div class="text-2xl font-bold text-amber-800">{chain}</div>
        </div>
        <div class="bg-green-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-green-600">Best Chain</div>
          <div class="text-2xl font-bold text-green-800">{bestChain}</div>
        </div>
        <div class="bg-purple-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-purple-600">Session XP</div>
          <div class="text-2xl font-bold text-purple-800">{sessionXp}</div>
        </div>
      </div>
    {/if}
  </div>
</div>
