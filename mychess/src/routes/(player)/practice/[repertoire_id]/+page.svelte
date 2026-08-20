<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import EngineEval from '$lib/components/EngineEval.svelte';
	import MoveNavRow from '$lib/components/MoveNavRow.svelte';
	import PracticeStatusStrip, { type PracticeStripState } from '$lib/components/PracticeStatusStrip.svelte';
	import type { Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { moveSequenceLabel, type VariationStep } from '$lib/mastery/variations';

	let { data } = $props<{ data: any }>();

	/**
	 * The Practice pool (#97): learned variations only, weakest-first, never an
	 * arrow. Deliberately a much smaller state machine than Learn's — there are no
	 * teaching batches, no autoplay intro and no retest cue here, because
	 * everything served is already learned. What Practice adds instead is
	 * demotion: failing a line, or asking for a hint on it, sends it back to Learn
	 * (#98).
	 */
	const queue = $derived((data.queue ?? []) as { variationKey: string; path: VariationStep[]; chapterNames: string[] }[]);

	let queueIdx = $state(0);
	let plyIdx = $state(0);
	let boardFen = $state('');
	let locked = $state(false);
	let strip = $state<PracticeStripState>('blind');
	// Set once a line is failed or hinted, so the outcome is reported exactly
	// once however many more moves the player makes on it.
	let outcomeReported = $state(false);
	let hintRequested = $state(false);
	let sessionPassed = $state(0);
	let sessionDemoted = $state(0);
	let advanceTimeout: ReturnType<typeof setTimeout> | undefined;
	let boardWidth = $state(0);
	let manualReviewIdx = $state<number | null>(null);

	const current = $derived(queue[queueIdx] ?? null);
	const steps = $derived(current?.path ?? []);
	const finished = $derived(queue.length > 0 && queueIdx >= queue.length);
	const reviewIdx = $derived(manualReviewIdx ?? plyIdx);
	const isReviewing = $derived(manualReviewIdx !== null);
	const movesSoFar = $derived(plyIdx > 0 ? moveSequenceLabel(steps.slice(0, plyIdx)) : '');

	function positionAt(plyCount: number): string {
		if (plyCount <= 0) return steps[0]?.fromFen ?? boardFen;
		return steps[plyCount - 1]?.toFen ?? boardFen;
	}
	const displayFen = $derived(isReviewing ? positionAt(reviewIdx) : boardFen);

	// Only ever the piece's own square, never the destination — same contract as
	// Learn's hint. Taking it has already cost the line its learned status, so
	// there is nothing further to protect.
	const hintSquare = $derived.by(() => {
		if (!hintRequested || isReviewing) return null;
		const step = steps[plyIdx];
		if (!step) return null;
		try {
			return new Chess(step.fromFen).move(step.san)?.from ?? null;
		} catch {
			return null;
		}
	});

	function advanceThroughOpponentReplies() {
		while (steps[plyIdx] && !steps[plyIdx].isPlayerTurn) {
			boardFen = steps[plyIdx].toFen;
			plyIdx++;
		}
	}

	function startCurrent() {
		clearTimeout(advanceTimeout);
		plyIdx = 0;
		manualReviewIdx = null;
		locked = false;
		hintRequested = false;
		outcomeReported = false;
		strip = 'blind';
		if (!current) return;
		boardFen = steps[0]?.fromFen ?? '';
		advanceThroughOpponentReplies();
	}

	// Set the first position synchronously — ChessBoard's onMount throws on an
	// empty FEN.
	startCurrent();

	// One session row per visit (#103) — set on the first outcome reported only.
	let sessionReported = false;

	function report(outcome: 'clean' | 'mistake' | 'hint') {
		const sessionStart = !sessionReported;
		sessionReported = true;
		fetch('/api/practice/pool-attempt', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ repertoireId: data.repertoire?.id, variationKey: current?.variationKey, outcome, sessionStart })
		}).catch(() => {});
	}

	function logMove(moveId: string, playedSan: string, isCorrect: boolean) {
		fetch('/api/practice/move-log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ repertoireId: data.repertoire?.id, moveId, playedSan, isCorrect })
		}).catch(() => {});
	}

	function toNext(delay: number) {
		advanceTimeout = setTimeout(() => {
			queueIdx++;
			startCurrent();
		}, delay);
	}

	function requestHint() {
		if (hintRequested || locked) return;
		hintRequested = true;
		// Reported immediately rather than at the end of the line: a player who
		// takes a hint and then navigates away has still had the answer, and the
		// demotion must not depend on them finishing.
		if (!outcomeReported) {
			outcomeReported = true;
			sessionDemoted++;
			report('hint');
		}
		strip = 'demoted';
	}

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (locked || isReviewing) return false;
		const step = steps[plyIdx];
		if (!step) return false;

		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			logMove(step.moveId, detail.san, true);
			// A hinted line keeps its demotion notice up while it is played out —
			// overwriting it with 'correct' would suggest the pass still counted.
			if (!outcomeReported) strip = 'correct';

			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				plyIdx++;
				advanceThroughOpponentReplies();
				locked = false;
				if (plyIdx >= steps.length) {
					if (!outcomeReported) {
						outcomeReported = true;
						sessionPassed++;
						report('clean');
					}
					toNext(700);
				} else if (!outcomeReported) {
					strip = 'blind';
				}
			}, 450);
			return true;
		}

		playWrong();
		logMove(step.moveId, detail.san, false);
		// Practice is a test: a wrong move ends the line rather than letting the
		// player retry it. The variation goes back to Learn, where it will be
		// re-taught with arrows — which is also why the correct move is still not
		// revealed here.
		if (!outcomeReported) {
			outcomeReported = true;
			sessionDemoted++;
			report('mistake');
			strip = 'demoted';
			locked = true;
			toNext(1600);
		}
		return false;
	}

	function reviewToStart() {
		manualReviewIdx = 0;
	}
	function reviewBack() {
		manualReviewIdx = Math.max(0, reviewIdx - 1);
	}
	function reviewForward() {
		const next = Math.min(plyIdx, reviewIdx + 1);
		manualReviewIdx = next >= plyIdx ? null : next;
	}
	function reviewToLive() {
		manualReviewIdx = null;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!current) return;
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			reviewBack();
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			reviewForward();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			reviewToStart();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			reviewToLive();
		}
	}
</script>

<svelte:head>
	<title>Practice {data.repertoire?.name ?? 'Repertoire'} — MyChess</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<main
	class="min-h-screen lg:min-h-0 lg:h-[calc(100vh-4rem)] lg:overflow-hidden bg-(--color-bg) p-4 max-w-7xl mx-auto pb-24 lg:pb-4 flex flex-col"
>
	<div class="mb-3 flex items-center gap-3 shrink-0 flex-wrap">
		<a href="/practice" class="text-(--color-muted) text-sm hover:text-(--color-text)">← All repertoires</a>
		<h1 class="text-base font-bold text-(--color-text) flex-1 min-w-0 truncate">{data.repertoire?.name}</h1>
		<a
			href="/practice/{data.repertoire?.id}/mastery"
			class="text-xs font-semibold text-(--color-accent) border border-(--color-border) rounded-lg px-2 py-1 hover:bg-(--color-border)/40"
		>
			Mastery
		</a>
		<a
			href="/learn/{data.repertoire?.id}"
			class="text-xs font-semibold text-(--color-muted) border border-(--color-border) rounded-lg px-2 py-1 hover:bg-(--color-border)/40"
		>
			Learn mode
		</a>
	</div>

	{#if data.learnedCount === 0}
		<!-- Also the landing spot for an old /practice/[id] bookmark, which used to
		     be the teaching flow before #96 moved it to /learn. -->
		<div class="flex flex-col items-center justify-center lg:flex-1 text-center gap-4 py-16">
			<p class="text-6xl">🔒</p>
			<h2 class="text-2xl font-bold text-(--color-text)">Nothing learned yet</h2>
			<p class="text-(--color-muted) max-w-md">
				Practice drills the lines you already know. Learn a variation first — two clean runs a day
				apart — and it turns up here.
			</p>
			<a
				href="/learn/{data.repertoire?.id}"
				class="bg-(--color-accent) text-white px-6 py-3 rounded-2xl font-bold hover:bg-(--color-accent-hover) transition"
			>
				Go to Learn
			</a>
		</div>
	{:else if finished}
		<div class="flex flex-col items-center justify-center lg:flex-1 text-center gap-4 py-16">
			<p class="text-6xl">{sessionDemoted === 0 ? '🎯' : '📚'}</p>
			<h2 class="text-2xl font-bold text-(--color-text)">Session complete</h2>
			<p class="text-(--color-muted)">
				{sessionPassed} held up{sessionDemoted > 0 ? `, ${sessionDemoted} went back to Learn` : ''}.
			</p>
			{#if sessionDemoted > 0}
				<a
					href="/learn/{data.repertoire?.id}"
					class="bg-(--color-accent) text-white px-6 py-3 rounded-2xl font-bold hover:bg-(--color-accent-hover) transition"
				>
					Re-learn {sessionDemoted === 1 ? 'that line' : 'those lines'}
				</a>
			{/if}
			<button
				onclick={() => {
					queueIdx = 0;
					sessionPassed = 0;
					sessionDemoted = 0;
					startCurrent();
				}}
				class="text-(--color-accent) hover:underline"
			>
				Practice again
			</button>
		</div>
	{:else}
		<div class="flex flex-col lg:flex-row lg:items-stretch gap-6 lg:flex-1 lg:min-h-0">
			<div class="lg:flex-1 lg:flex lg:flex-col lg:min-h-0 lg:items-start">
				<PracticeStatusStrip state={strip} />

				<div class="w-full lg:flex-1 lg:min-h-0 lg:flex lg:items-start lg:justify-center lg:[container-type:size]">
					<ChessBoard
						fen={displayFen}
						orientation={data.repertoire?.color === 'black' ? 'black' : 'white'}
						interactable={!locked && !isReviewing}
						onmove={handleMove}
						prefs={data.boardPrefs}
						{hintSquare}
						arrowMove={null}
						containerFit
						bind:boxWidth={boardWidth}
					/>
				</div>

				<MoveNavRow
					{reviewIdx}
					totalPlies={steps.length}
					{isReviewing}
					{boardWidth}
					onstart={reviewToStart}
					onback={reviewBack}
					onforward={reviewForward}
					onlive={reviewToLive}
				/>
			</div>

			<aside
				class="w-full lg:w-80 lg:shrink-0 hidden lg:flex lg:flex-col divide-y divide-(--color-border) bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm lg:overflow-y-auto"
			>
				<div class="p-4 flex flex-col gap-2">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted)">This session</p>
					<p class="text-sm text-(--color-text) tabular-nums">
						Line {Math.min(queueIdx + 1, queue.length)} of {queue.length}
					</p>
					<div class="h-1.5 rounded-full bg-(--color-border) overflow-hidden">
						<div
							class="h-full bg-(--color-accent) rounded-full"
							style={`width: ${queue.length ? (queueIdx / queue.length) * 100 : 0}%`}
						></div>
					</div>
					<p class="text-xs text-(--color-muted)">
						{sessionPassed} held up · {sessionDemoted} back to Learn
					</p>
				</div>

				<div class="p-4 flex flex-col gap-1">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted)">This line</p>
					{#if current?.chapterNames?.length}
						<p class="text-sm text-(--color-text) font-medium">{current.chapterNames.join(' · ')}</p>
					{/if}
					<p class="text-sm text-(--color-muted) font-mono">{movesSoFar || '—'}</p>
				</div>

				<div class="p-4">
					<EngineEval fen={displayFen} />
				</div>

				<div class="p-4 flex flex-col gap-2">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted)">Stuck?</p>
					<button
						onclick={requestHint}
						disabled={hintRequested}
						class="self-start inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400 border border-amber-400/40 bg-amber-400/10 rounded-lg px-2.5 py-1.5 disabled:opacity-40"
					>
						<span aria-hidden="true">💡</span> Show hint
					</button>
					<p class="text-xs text-(--color-muted)">
						Reveals the piece — and sends this line back to Learn, since knowing it means playing it
						unaided.
					</p>
					<p class="text-xs text-(--color-muted)">← → step · ↑ start · ↓ live</p>
				</div>

				<div class="p-4 mt-auto">
					<a href="/practice" class="text-sm text-(--color-muted) hover:text-(--color-text)">Finish session</a>
				</div>
			</aside>
		</div>
	{/if}
</main>
