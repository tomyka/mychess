<script lang="ts">
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import { onDestroy } from 'svelte';
  import type { Key } from 'chessground/types';
  import { playCorrect, playWrong } from '$lib/sounds';

  let { data } = $props<{ data: any }>();

  const allMoves = $derived((data as any).trialMoves ?? []);

  const DURATION = 60;

  let currentIdx = $state(0);
  let correct = $state(0);
  let timeLeft = $state(DURATION);
  let started = $state(false);
  let finished = $state(false);
  let wrongMove = $state(false);
  let sessionXp = $state(0);

  let timer: ReturnType<typeof setInterval> | null = null;

  const current = $derived(allMoves[currentIdx % allMoves.length]);
  const boardFen = $derived(
    current?.from_position?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  );

  function start() {
    started = true;
    timer = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) {
        clearInterval(timer!);
        timer = null;
        finished = true;
        submitResult();
      }
    }, 1000);
  }

  function handleMove(detail: { from: Key; to: Key; san: string }) {
    if (!started || finished) return false;
    const targetSan = current?.san;

    if (detail.san === targetSan) {
      playCorrect();
      wrongMove = false;
      correct++;
      sessionXp += 5;
      currentIdx++;
      return true;
    } else {
      playWrong();
      wrongMove = true;
      return false;
    }
  }

  function restart() {
    if (timer) clearInterval(timer);
    timer = null;
    currentIdx = 0;
    correct = 0;
    timeLeft = DURATION;
    started = false;
    finished = false;
    wrongMove = false;
    sessionXp = 0;
  }

  async function submitResult() {
    const bonus = correct >= 20 ? 200 : 0;
    await fetch('/api/time-trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct, sessionXp: sessionXp + bonus, bonus })
    });
    if (bonus > 0) sessionXp += bonus;
  }

  onDestroy(() => { if (timer) clearInterval(timer); });
</script>

<svelte:head>
  <title>Time Trial — MyChess</title>
</svelte:head>

{#if data.needsAccount}
  <div class="max-w-md mx-auto text-center py-16 space-y-4">
    <h1 class="text-2xl font-bold text-gray-900">Sign in to train</h1>
    <p class="text-gray-500">Guest training is unavailable right now. Create a free account to start.</p>
    <a href="/login?signup=1" class="inline-block bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700">Get started</a>
  </div>
{:else}
<div class="min-h-screen bg-gray-50 p-4">
  <div class="max-w-lg mx-auto">
    <div class="flex justify-between items-center mb-4">
      <a href="/" class="text-gray-400 text-sm hover:text-gray-600">← Home</a>
      <h1 class="text-xl font-bold text-gray-900">Time Trial</h1>
      <div class="text-right">
        <div class="text-2xl font-bold {timeLeft <= 10 ? 'text-red-600 animate-pulse' : 'text-indigo-600'}">{timeLeft}s</div>
        <div class="text-xs text-gray-400">✅ {correct}</div>
      </div>
    </div>

    {#if allMoves.length === 0}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-xl text-gray-700">No moves to drill yet!</p>
        <p class="text-gray-400 mt-2">Add moves in Master mode first.</p>
        <a href="/master"
           class="mt-4 inline-block bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-indigo-700 transition">
          Go to Master
        </a>
      </div>
    {:else if finished}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-2">{correct >= 20 ? '🏆' : correct >= 10 ? '🎉' : '⏱️'}</p>
        <h2 class="text-2xl font-bold text-indigo-700">Time's Up!</h2>
        <p class="text-gray-500 mt-2">You got <strong>{correct}</strong> correct in 60 seconds</p>
        {#if correct >= 20}
          <p class="text-green-600 font-bold mt-1">+200 Bonus XP for 20+ correct!</p>
        {/if}
        <button onclick={restart}
                class="mt-4 w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          Play Again
        </button>
        <a href="/" class="mt-2 block text-center text-gray-400 hover:underline text-sm">Back to Home</a>
      </div>
    {:else if !started}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-3">⏱️</p>
        <h2 class="text-xl font-bold text-gray-900 mb-2">60-Second Challenge!</h2>
        <p class="text-gray-500 mb-4">Answer as many opening moves as you can. +5 XP per correct, +200 bonus for 20+!</p>
        <button onclick={start}
                class="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-xl hover:bg-indigo-700 transition">
          Start!
        </button>
      </div>
    {:else}
      <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mb-4">
        <p class="text-center text-gray-400 text-sm mb-2">
          {#if wrongMove}
            <span class="text-red-600 font-bold">Wrong move! Try again!</span>
          {:else}
            Play the correct opening move!
          {/if}
        </p>
        <ChessBoard fen={boardFen} interactable={true} onmove={handleMove} />
      </div>

      <div class="flex gap-2 justify-center">
        <div class="bg-green-50 border border-green-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-green-500">Correct</div>
          <div class="text-2xl font-bold text-green-700">{correct}</div>
        </div>
        <div class="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-indigo-400">XP</div>
          <div class="text-2xl font-bold text-indigo-700">{sessionXp}</div>
        </div>
        <div class="bg-red-50 border border-red-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-red-400">Time</div>
          <div class="text-2xl font-bold text-red-600">{timeLeft}s</div>
        </div>
      </div>
    {/if}
  </div>
</div>
{/if}
