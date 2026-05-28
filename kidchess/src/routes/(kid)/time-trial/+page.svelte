<script lang="ts">
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import SirKnight from '$lib/components/SirKnight.svelte';
  import { onMount, onDestroy } from 'svelte';
  import type { Key } from 'chessground/types';

  let { data } = $props<{ data: any }>();

  const allMoves: any[] = (data as any).trialMoves ?? [];

  const DURATION = 60;

  let currentIdx = $state(0);
  let correct = $state(0);
  let timeLeft = $state(DURATION);
  let started = $state(false);
  let finished = $state(false);
  let wrongMove = $state(false);
  let sessionXp = $state(0);
  let mood = $state<'idle' | 'cheer' | 'sad' | 'surprise' | 'sleepy' | 'party'>('idle');

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
        mood = correct >= 20 ? 'party' : correct >= 10 ? 'cheer' : 'idle';
        submitResult();
      }
    }, 1000);
  }

  function handleMove(detail: { from: Key; to: Key; san: string }) {
    if (!started || finished) return;
    const targetSan = current?.san;

    if (detail.san === targetSan) {
      wrongMove = false;
      correct++;
      sessionXp += 5;
      mood = 'cheer';
      setTimeout(() => { mood = 'idle'; }, 500);
      currentIdx++;
    } else {
      wrongMove = true;
      mood = 'sad';
      setTimeout(() => { mood = 'idle'; }, 500);
    }
  }

  function restart() {
    currentIdx = 0;
    correct = 0;
    timeLeft = DURATION;
    started = false;
    finished = false;
    wrongMove = false;
    sessionXp = 0;
    mood = 'idle';
    if (timer) { clearInterval(timer); timer = null; }
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

<div class="min-h-screen bg-gradient-to-b from-blue-50 to-cyan-100 p-4">
  <div class="max-w-lg mx-auto">
    <!-- Header -->
    <div class="flex justify-between items-center mb-4">
      <a href="/" class="text-2xl">⬅️</a>
      <h1 class="text-2xl font-bold text-blue-800">⏱️ Time Trial</h1>
      <div class="text-right">
        <div class="text-2xl font-bold {timeLeft <= 10 ? 'text-red-600 animate-pulse' : 'text-blue-600'}">{timeLeft}s</div>
        <div class="text-sm text-blue-500">✅ {correct}</div>
      </div>
    </div>

    <SirKnight {mood} />

    {#if allMoves.length === 0}
      <div class="bg-white rounded-2xl p-6 text-center shadow">
        <p class="text-xl">🎓 No moves to drill yet!</p>
        <p class="text-gray-500 mt-2">Add moves in Learn mode first.</p>
        <a href="/learn" class="mt-4 block btn-primary">Go to Learn</a>
      </div>
    {:else if finished}
      <div class="bg-white rounded-2xl p-6 text-center shadow">
        <p class="text-4xl mb-2">{correct >= 20 ? '🏆' : correct >= 10 ? '🎉' : '⏱️'}</p>
        <h2 class="text-2xl font-bold text-blue-700">Time's Up!</h2>
        <p class="text-gray-600 mt-2">You got <strong>{correct}</strong> correct in 60 seconds</p>
        <p class="text-amber-600 font-bold mt-1">+{sessionXp} XP earned</p>
        {#if correct >= 20}
          <p class="text-green-600 font-bold mt-1">+200 Bonus XP for 20+ correct! 🚀</p>
        {/if}
        <button onclick={restart} class="mt-4 w-full bg-blue-500 text-white py-3 rounded-xl font-bold text-lg hover:bg-blue-600 transition">
          Play Again 🔄
        </button>
        <a href="/" class="mt-2 block text-center text-gray-500 hover:underline">Back to Home</a>
      </div>
    {:else if !started}
      <div class="bg-white rounded-2xl p-6 text-center shadow">
        <p class="text-4xl mb-3">⏱️</p>
        <h2 class="text-xl font-bold text-blue-700 mb-2">60-Second Challenge!</h2>
        <p class="text-gray-600 mb-4">Answer as many opening moves as you can in 60 seconds. +5 XP per correct move, +200 bonus for 20+!</p>
        <button onclick={start} class="w-full bg-blue-500 text-white py-4 rounded-xl font-bold text-xl hover:bg-blue-600 transition">
          Start! 🚀
        </button>
      </div>
    {:else}
      <div class="bg-white rounded-2xl p-4 shadow mb-4">
        <p class="text-center text-gray-500 text-sm mb-2">
          {#if wrongMove}
            <span class="text-red-500 font-bold">❌ Wrong move! Try again!</span>
          {:else}
            Play the correct opening move!
          {/if}
        </p>
        <ChessBoard fen={boardFen} interactable={true} onmove={handleMove} />
      </div>

      <div class="flex gap-2 justify-center">
        <div class="bg-blue-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-blue-600">Correct</div>
          <div class="text-2xl font-bold text-blue-800">{correct}</div>
        </div>
        <div class="bg-amber-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-amber-600">XP</div>
          <div class="text-2xl font-bold text-amber-800">{sessionXp}</div>
        </div>
        <div class="bg-red-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-red-600">Time</div>
          <div class="text-2xl font-bold text-red-800">{timeLeft}s</div>
        </div>
      </div>
    {/if}
  </div>
</div>
