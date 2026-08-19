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
  }

  async function submitResult() {
    await fetch('/api/time-trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct })
    });
  }

  onDestroy(() => { if (timer) clearInterval(timer); });
</script>

<svelte:head>
  <title>Time Trial — MyChess</title>
</svelte:head>

<div class="min-h-screen bg-(--color-bg) p-4">
  <div class="max-w-3xl mx-auto">
    <div class="flex justify-between items-center mb-4">
      <a href="/" class="text-(--color-muted) text-sm hover:text-(--color-text)">← Home</a>
      <h1 class="text-xl font-bold text-(--color-text)">Time Trial</h1>
      <div class="text-right">
        <div class="text-2xl font-bold {timeLeft <= 10 ? 'text-red-600 dark:text-red-400 animate-pulse' : 'text-(--color-accent)'}">{timeLeft}s</div>
        <div class="text-xs text-(--color-muted)">✅ {correct}</div>
      </div>
    </div>

    {#if allMoves.length === 0}
      <div class="bg-(--color-surface) border border-(--color-border) rounded-2xl p-6 text-center shadow-sm">
        <p class="text-xl text-(--color-text)">No moves to drill yet!</p>
        <p class="text-(--color-muted) mt-2">Add moves in Practice mode first.</p>
        <a href="/practice"
           class="mt-4 inline-block bg-(--color-accent) text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-(--color-accent-hover) transition">
          Go to Practice
        </a>
      </div>
    {:else if finished}
      <div class="bg-(--color-surface) border border-(--color-border) rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-2">{correct >= 20 ? '🏆' : correct >= 10 ? '🎉' : '⏱️'}</p>
        <h2 class="text-2xl font-bold text-indigo-700">Time's Up!</h2>
        <p class="text-(--color-muted) mt-2">You got <strong>{correct}</strong> correct in 60 seconds</p>
        <button onclick={restart}
                class="mt-4 w-full bg-(--color-accent) text-white py-3 rounded-xl font-bold text-lg hover:bg-(--color-accent-hover) transition">
          Play Again
        </button>
        <a href="/" class="mt-2 block text-center text-(--color-muted) hover:underline text-sm">Back to Home</a>
      </div>
    {:else if !started}
      <div class="bg-(--color-surface) border border-(--color-border) rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-3">⏱️</p>
        <h2 class="text-xl font-bold text-(--color-text) mb-2">60-Second Challenge!</h2>
        <p class="text-(--color-muted) mb-4">Answer as many opening moves as you can, before time runs out!</p>
        <button onclick={start}
                class="w-full bg-(--color-accent) text-white py-4 rounded-xl font-bold text-xl hover:bg-(--color-accent-hover) transition">
          Start!
        </button>
      </div>
    {:else}
      <div class="bg-(--color-surface) border border-(--color-border) rounded-2xl p-4 shadow-sm mb-4">
        <p class="text-center text-(--color-muted) text-sm mb-2">
          {#if wrongMove}
            <span class="text-red-600 dark:text-red-400 font-bold">Wrong move! Try again!</span>
          {:else}
            Play the correct opening move!
          {/if}
        </p>
        <ChessBoard fen={boardFen} interactable={true} onmove={handleMove} prefs={data.boardPrefs} />
      </div>

      <div class="flex gap-2 justify-center">
        <div class="bg-green-50 border border-green-100 rounded-xl px-4 py-2 text-center dark:bg-green-950 dark:border-green-800">
          <div class="text-xs text-green-500 dark:text-green-400">Correct</div>
          <div class="text-2xl font-bold text-green-700 dark:text-green-400">{correct}</div>
        </div>
        <div class="bg-red-50 border border-red-100 rounded-xl px-4 py-2 text-center dark:bg-red-950 dark:border-red-800">
          <div class="text-xs text-red-400 dark:text-red-400">Time</div>
          <div class="text-2xl font-bold text-red-600 dark:text-red-400">{timeLeft}s</div>
        </div>
      </div>
    {/if}
  </div>
</div>
