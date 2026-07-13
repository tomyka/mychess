<script lang="ts">
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import type { Key } from 'chessground/types';
  import { Chess } from 'chess.js';
  import { playCorrect, playWrong, playLevelUp } from '$lib/sounds';
  import { evaluatePosition } from '$lib/engine/stockfish';
  import { evaluateSwing } from '$lib/engine/classify';
  import { findBookMove, type BookMoveEntry } from '$lib/repertoire';
  import { offBookOutcome, outcomeForcesRetry, nextChain, type FeedbackOutcome } from './feedback';
  import type { Marker } from '$lib/components/chessboard-marker';

  let { data } = $props<{ data: any }>();

  const allMoves = $derived((data as any).masterMoves ?? []);
  const bookMoveMap = $derived((data as any).bookMoveMap ?? {});

  let currentIdx = $state(0);
  let chain = $state(0);
  let bestChain = $state(0);
  let sessionXp = $state(0);
  let finished = $state(false);
  let retrying = $state(false);
  let evaluating = $state(false);
  let marker = $state<Marker>(null);
  let forceRevert = $state(0);
  let revealSan = $state<string | null>(null);
  let feedbackLabel = $state<string | null>(null);
  let evalRequestId = 0;

  const current = $derived(allMoves[currentIdx]);
  const boardFen = $derived(
    current?.from_pos?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  );
  const bookEntries = $derived<BookMoveEntry[]>(
    current ? (bookMoveMap[current.from_position] ?? []) : []
  );

  function applyOutcome(outcome: FeedbackOutcome) {
    chain = nextChain(chain, outcome);
    if (chain > bestChain) bestChain = chain;
  }

  function advance() {
    retrying = false;
    evaluating = false;
    marker = null;
    revealSan = null;
    feedbackLabel = null;

    if (chain === 10) {
      playLevelUp();
      sessionXp += 50;
      finished = true;
      submitMasterResult();
      return;
    }
    if (currentIdx + 1 >= allMoves.length) {
      finished = true;
      submitMasterResult();
    } else {
      currentIdx++;
    }
  }

  function reportBookMove(moveId: string) {
    fetch('/api/master/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moveId })
    }).catch(() => {});
  }

  function handleMove(detail: { from: Key; to: Key; san: string }) {
    if (finished || evaluating) return;

    const matched = findBookMove(bookEntries, detail.san);
    if (matched) {
      playCorrect();
      marker = { square: detail.to, kind: 'star' };
      applyOutcome('star');
      sessionXp += 2;
      reportBookMove(matched.id);
      advance();
      return;
    }

    playWrong();
    evaluating = true;
    marker = { square: detail.to, kind: 'pending' };
    revealSan = current.san;
    gradeOffBookMove(current, detail.san, detail.to);
  }

  async function gradeOffBookMove(dueMove: any, playedSan: string, destSquare: Key) {
    const requestId = ++evalRequestId;
    try {
      const bookChess = new Chess(dueMove.from_pos.fen);
      bookChess.move(dueMove.san);
      const playedChess = new Chess(dueMove.from_pos.fen);
      playedChess.move(playedSan);

      const [bookScore, playedScore] = await Promise.all([
        evaluatePosition(bookChess.fen(), 800),
        evaluatePosition(playedChess.fen(), 800)
      ]);
      if (requestId !== evalRequestId) return;

      const { quality } = evaluateSwing(bookScore, playedScore);
      resolveOffBookOutcome(offBookOutcome(quality), destSquare);
    } catch {
      if (requestId === evalRequestId) resolveOffBookOutcome('unknown', destSquare);
    }
  }

  function resolveOffBookOutcome(outcome: FeedbackOutcome, destSquare: Key) {
    applyOutcome(outcome);

    if (outcome === 'unknown') {
      marker = null;
      feedbackLabel = null;
    } else {
      marker = { square: destSquare, kind: outcome };
      feedbackLabel = outcome === 'check' ? 'Also fine' : 'Not quite — play the book move to continue';
    }

    if (outcome !== 'unknown' && !outcomeForcesRetry(outcome) && !retrying) {
      // A fresh ✓ (off-book but not a mistake) — briefly show the icon,
      // then move on, same as playing the book move.
      setTimeout(advance, 900);
      return;
    }

    if (outcome === 'unknown' && !retrying) {
      // Engine unavailable on a fresh attempt — no icon, advance right away,
      // same as today's plain wrong-move fallback.
      advance();
      return;
    }

    // A real mistake, or any off-book attempt while already in a forced
    // retry — stays on this card until the book move is played.
    retrying = true;
    evaluating = false;
    forceRevert++;
  }

  function restart() {
    currentIdx = 0;
    chain = 0;
    bestChain = 0;
    sessionXp = 0;
    finished = false;
    retrying = false;
    evaluating = false;
    marker = null;
    revealSan = null;
    feedbackLabel = null;
  }

  async function submitMasterResult() {
    await fetch('/api/master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain, sessionXp, bestChain })
    });
  }
</script>

<svelte:head>
  <title>Master Mode — MyChess</title>
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
      <h1 class="text-xl font-bold text-gray-900">Master Mode</h1>
      <div class="text-right">
        <div class="text-base font-bold text-indigo-600">Chain: {chain}</div>
        <div class="text-xs text-gray-400">XP: {sessionXp}</div>
      </div>
    </div>

    {#if allMoves.length === 0}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-xl text-gray-700">No moves to master yet!</p>
        <p class="text-gray-400 mt-2">Build or get assigned a repertoire to start training.</p>
        <a href="/repertoires"
           class="mt-4 inline-block bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-indigo-700 transition">
          Go to Repertoires
        </a>
      </div>
    {:else if finished}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-2">🏆</p>
        <h2 class="text-2xl font-bold text-green-600">Session Complete!</h2>
        <p class="text-gray-500 mt-2">Best chain: <strong>{bestChain}</strong> moves</p>
        {#if bestChain >= 10}
          <p class="text-green-600 font-bold mt-1">+50 bonus XP for a 10-chain!</p>
        {/if}
        <button onclick={restart}
                class="mt-4 w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          Go Again
        </button>
        <a href="/" class="mt-2 block text-center text-gray-400 hover:underline text-sm">Back to Home</a>
      </div>
    {:else}
      <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mb-4">
        <p class="text-center text-gray-400 text-sm mb-2">
          Move {currentIdx + 1} / {allMoves.length} · Play the best move!
        </p>
        {#if revealSan}
          <p class="text-center text-sm mb-2">
            <span class="font-semibold text-gray-600">Book move: {revealSan}</span>
          </p>
        {/if}
        {#if feedbackLabel}
          <p class="text-center font-bold text-sm mb-2 {feedbackLabel.startsWith('Not quite') ? 'text-red-600' : 'text-blue-600'}">
            {feedbackLabel}
          </p>
        {/if}
        <ChessBoard
          fen={boardFen}
          interactable={!evaluating}
          onmove={handleMove}
          {marker}
          {forceRevert}
          prefs={data.boardPrefs}
        />
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
