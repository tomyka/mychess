<!-- mychess/src/routes/(player)/master/[repertoire_id]/+page.svelte -->
<script lang="ts">
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import { Chess } from 'chess.js';
  import type { Key } from 'chessground/types';
  import { playCorrect, playWrong } from '$lib/sounds';
  import { evaluatePosition } from '$lib/engine/stockfish';
  import { evaluateSwing, type MoveQuality } from '$lib/engine/classify';
  import { invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';

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

  let quizIdx = $state(0);
  let boardFen = $state('');
  let phase = $state<'playing' | 'wrong' | 'success'>('playing');
  let engineLoading = $state(false);
  let engineFeedback = $state<{ swingCp: number; quality: MoveQuality } | null>(null);
  let evalRequestId = 0;
  let sessionXp = $state(0);
  let submitting = $state(false);

  const attempt = $derived(data.attempt);

  function advanceThroughOpponentReplies() {
    while (attempt?.quizSteps[quizIdx] && !attempt.quizSteps[quizIdx].isPlayerTurn) {
      boardFen = attempt.quizSteps[quizIdx].toFen;
      quizIdx++;
    }
  }

  function resetForAttempt() {
    quizIdx = 0;
    phase = 'playing';
    engineFeedback = null;
    engineLoading = false;
    if (attempt) {
      boardFen =
        attempt.prefix.length > 0
          ? attempt.prefix[attempt.prefix.length - 1].toFen
          : (attempt.quizSteps[0]?.fromFen ?? '');
      advanceThroughOpponentReplies();
    }
  }

  resetForAttempt();

  $effect(() => {
    attempt;
    untrack(() => resetForAttempt());
  });

  function handleMove(detail: { from: Key; to: Key; san: string }) {
    if (phase !== 'playing') return false;
    const step = attempt?.quizSteps[quizIdx];
    if (!step) return false;

    if (detail.san === step.san) {
      playCorrect();
      boardFen = step.toFen;
      quizIdx++;
      advanceThroughOpponentReplies();
      if (quizIdx >= attempt.quizSteps.length) {
        succeed();
      }
      return true;
    } else {
      playWrong();
      phase = 'wrong';
      evaluateWrongMove(step, detail.san);
      return false;
    }
  }

  async function evaluateWrongMove(step: { fromFen: string; san: string }, playedSan: string) {
    const requestId = ++evalRequestId;
    engineFeedback = null;
    engineLoading = true;
    try {
      const bookChess = new Chess(step.fromFen);
      bookChess.move(step.san);
      const playedChess = new Chess(step.fromFen);
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

  async function succeed() {
    phase = 'success';
    submitting = true;
    try {
      const res = await fetch('/api/mastery/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repertoireId: data.repertoire.id,
          leafMoveId: attempt.leafMoveId,
          variationKey: attempt.variationKey,
          depthReached: attempt.targetDepth
        })
      });
      const result = await res.json();
      sessionXp += result.xpAwarded ?? 0;
    } catch {
      // XP submission failed — the practice attempt itself still succeeded and
      // is already shown to the player; just skip the XP bump silently rather
      // than blocking their progress on a network hiccup.
    } finally {
      submitting = false;
    }
  }

  async function nextAttempt() {
    evalRequestId++;
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>Master {data.repertoire?.name ?? 'Repertoire'} — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50 p-4 max-w-lg mx-auto pb-24">
  <div class="flex items-center justify-between mb-4">
    <a href="/master" class="text-gray-400 text-sm hover:text-gray-600">← All Repertoires</a>
    <span class="text-indigo-600 font-bold text-sm">+{sessionXp} XP</span>
  </div>

  {#if data.level === 'mastered' && data.totalVariations > 0}
    <div class="flex flex-col items-center justify-center min-h-screen gap-6 text-center">
      <p class="text-7xl">🏆</p>
      <h1 class="text-3xl font-bold text-gray-900">Repertoire Mastered!</h1>
      <p class="text-gray-500">Every variation in {data.repertoire?.name} is fully learned.</p>
      <a href="/master" class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition">
        Back to Repertoires
      </a>
    </div>
  {:else if !attempt}
    <div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
      <p class="text-5xl">📭</p>
      <h1 class="text-2xl font-bold text-gray-700">Nothing to practice</h1>
      <p class="text-gray-400">This repertoire has no moves for your color yet.</p>
      <a href="/master" class="text-indigo-600 hover:underline">Back to Repertoires</a>
    </div>
  {:else}
    <p class="text-center text-gray-400 text-sm font-medium mb-2">
      {data.repertoire?.name} · Level {data.level} · {data.satisfiedCount}/{data.totalVariations} solved
    </p>
    <p class="text-center text-gray-700 font-semibold mb-4">
      {phase === 'playing' ? 'What is the best move?' : ''}
    </p>

    <ChessBoard fen={boardFen} interactable={phase === 'playing'} onmove={handleMove} />

    {#if phase === 'wrong'}
      <div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
        <p class="text-xl font-bold mb-1 text-gray-700">Not quite — back to the start of this line</p>
        {#if engineLoading}
          <p class="text-sm text-gray-400 mt-2">Evaluating…</p>
        {:else if engineFeedback}
          <p class="text-sm mt-2 font-semibold {QUALITY_COLOR[engineFeedback.quality]}">
            {QUALITY_LABEL[engineFeedback.quality]}{#if engineFeedback.quality !== 'fine'} (−{engineFeedback.swingCp}cp){/if}
          </p>
        {/if}
        <button onclick={nextAttempt}
                class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          Try Again
        </button>
      </div>
    {:else if phase === 'success'}
      <div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
        <p class="text-xl font-bold mb-1 text-green-600">✅ Solved!</p>
        <button onclick={nextAttempt} disabled={submitting}
                class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition disabled:opacity-50">
          Continue
        </button>
      </div>
    {/if}
  {/if}
</main>
