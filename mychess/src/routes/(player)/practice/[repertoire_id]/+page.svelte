<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import EvalBar from '$lib/components/EvalBar.svelte';
	import EngineToggle from '$lib/components/EngineToggle.svelte';
	import { engineEnabled } from '$lib/engine/engine.svelte';
	import MoveNavRow from '$lib/components/MoveNavRow.svelte';
	import PracticeStatusStrip, { type PracticeStripState } from '$lib/components/PracticeStatusStrip.svelte';
	import RepertoireUpdatedBanner from '$lib/components/RepertoireUpdatedBanner.svelte';
	import type { Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { moveSequenceLabel, type VariationStep } from '$lib/mastery/variations';
	import { positionAt, playOpponentReplies, playerMovesIn } from '$lib/mastery/playback';
	import { logMove } from '$lib/moveLog';
	import { ExploreSession } from '$lib/mastery/explore.svelte';

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
	// Explore mode (#125), the same scratch board Learn has and the same module
	// behind it: it owns only its own position, so an excursion cannot touch
	// plyIdx, boardFen, outcomeReported or hintRequested — which matters more here
	// than on Learn, where a stray mistake only costs a clean pass. In Practice it
	// would demote the line.
	const explore = new ExploreSession();
	// True when the excursion was opened FROM a demoted line (#131): the line is
	// already reported and finished, so leaving the excursion moves on to the next
	// one instead of returning to a board that was about to disappear.
	let exploringDemoted = $state(false);
	// The position a wrong move produced, kept aside so "see why" can open on the
	// consequence rather than on the question. Never applied to the board.
	let mistakeFen = $state<string | null>(null);

	const current = $derived(queue[queueIdx] ?? null);
	const steps = $derived(current?.path ?? []);
	const finished = $derived(queue.length > 0 && queueIdx >= queue.length);
	const reviewIdx = $derived(manualReviewIdx ?? plyIdx);
	const isReviewing = $derived(manualReviewIdx !== null);
	const movesSoFar = $derived(plyIdx > 0 ? moveSequenceLabel(steps.slice(0, plyIdx)) : '');

	const drillFen = $derived(isReviewing ? positionAt(steps, reviewIdx, boardFen) : boardFen);
	// The explored position while off-book, the drill's own otherwise. The eval bar
	// reads the same value, so it answers for whatever is actually on the board —
	// and an off-book position has no precomputed eval, which is what makes the
	// local engine spawn there and nowhere else (#126).
	const displayFen = $derived(explore.active ? explore.fen : drillFen);
	// Only while the drill is genuinely waiting for a move. `locked` covers both
	// the correct-move hold and the 1.6s window after a wrong move, when the line
	// is already demoted and about to be replaced.
	const canExplore = $derived(!!current && !locked && !isReviewing && !!drillFen);

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
		const played = playOpponentReplies(steps, plyIdx, boardFen);
		plyIdx = played.plyIdx;
		boardFen = played.fen;
	}

	function startCurrent() {
		clearTimeout(advanceTimeout);
		explore.stop();
		exploringDemoted = false;
		mistakeFen = null;
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


	function toNext(delay: number) {
		advanceTimeout = setTimeout(() => {
			queueIdx++;
			startCurrent();
		}, delay);
	}

	function requestHint() {
		if (hintRequested || locked) return;
		// Same reason as Learn's: hintSquare is null while reviewing, so a hint
		// taken from a stepped-back position demoted the line and drew nothing.
		manualReviewIdx = null;
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

	function startExplore() {
		if (!canExplore) return;
		exploringDemoted = false;
		explore.start(drillFen);
	}

	/**
	 * Explore a line that has just been failed (#131). The wrong move is already
	 * on the board here, which is the whole point — the player wants to see what
	 * it does, and Practice deliberately never shows them the right move.
	 *
	 * Cancels the pending advance so the position stays put. The outcome was
	 * reported at the moment of the mistake, so nothing about the record changes.
	 */
	function exploreDemoted() {
		clearTimeout(advanceTimeout);
		advanceTimeout = undefined;
		exploringDemoted = true;
		explore.start(mistakeFen ?? boardFen);
	}

	/**
	 * Leaves explore mode. Nothing to restore: the drill's state was never handed
	 * over, and `strip` is read through a derived below rather than overwritten,
	 * so whatever message was up comes back on its own.
	 */
	function stopExplore() {
		const wasDemoted = exploringDemoted;
		exploringDemoted = false;
		explore.stop();
		// The demoted line is finished — its outcome is already recorded — so the
		// only place to go is the next one. Advanced directly rather than by
		// re-arming the timer, so this can't double-advance with a timer that was
		// cancelled on the way in.
		if (wasDemoted) {
			queueIdx++;
			startCurrent();
		}
	}

	/**
	 * The board's one move handler for both modes — dispatching at call time
	 * rather than swapping ChessBoard's `onmove` prop, so it can't route a drill
	 * move into a dead excursion whenever the config is rebuilt.
	 */
	function handleBoardMove(detail: { from: Key; to: Key; san: string }) {
		if (explore.active) return explore.play(detail.from, detail.to);
		return handleMove(detail);
	}

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (locked || isReviewing) return false;
		const step = steps[plyIdx];
		if (!step) return false;

		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			logMove(data.repertoire?.id, step.moveId, detail.san, true);
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
		logMove(data.repertoire?.id, step.moveId, detail.san, false);
		// Remembered, NOT applied to the board: `boardFen` staying on the position
		// the player was asked about is what lets ChessBoard hold the wrong move
		// under its red X and then snap back, and what keeps a second attempt
		// reaching handleMove to be ignored. This is only where a "see why"
		// excursion should open from.
		try {
			const board = new Chess(step.fromFen);
			board.move({ from: detail.from, to: detail.to, promotion: 'q' });
			mistakeFen = board.fen();
		} catch {
			mistakeFen = null;
		}
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
		// Not while exploring: the arrows step through drill plies, and none of the
		// explored moves are drill plies.
		if (!current || explore.active) return;
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

	<!-- OUTSIDE the status strip's slot, and above it, on purpose. That slot's
	     height is pinned (min-h-12, fixed leading — see PracticeStatusStrip)
	     because mobile stacks it straight onto the board, so any content-driven
	     height difference between its states moves the board's top edge mid-drill
	     (#113, fixed in 2fa68dd). This banner is a variable-height block that
	     appears for some students and not others and can be dismissed mid-session
	     — putting it in that slot would reintroduce exactly the shift the pin
	     exists to prevent. As its own sibling above the layout it takes its space
	     once, before the board, and the strip's slot stays fixed.

	     Above the state branch rather than inside it, too: a coach update DEMOTES
	     lines, which routinely drops a student into the "nothing learned yet" or
	     "finish a chapter" states below — the states where an unexplained
	     backwards step is most alarming and most needs attributing to the coach. -->
	<RepertoireUpdatedBanner lineCount={data.coachUpdatedLines ?? 0} />

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
	{:else if queue.length === 0}
		<!-- learnedCount > 0 here, but no whole chapter is finished yet — a lone
		     learned line inside an unfinished chapter doesn't unlock Practice for
		     it (see +page.server.ts's fullyLearnedChapters gate). -->
		<div class="flex flex-col items-center justify-center lg:flex-1 text-center gap-4 py-16">
			<p class="text-6xl">📖</p>
			<h2 class="text-2xl font-bold text-(--color-text)">Finish a chapter to unlock Practice</h2>
			<p class="text-(--color-muted) max-w-md">
				{data.learnedCount}
				{data.learnedCount === 1 ? 'line is' : 'lines are'} learned, but Practice only drills a chapter
				once every line in it is learned. Keep going in Learn to finish one.
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
				<!-- Explore wins the strip outright while it lasts: every other message
				     would be describing a position that isn't on screen. Read through a
				     derived rather than assigned, so `strip`'s real value survives the
				     excursion untouched. -->
				<PracticeStatusStrip state={explore.active ? 'exploring' : strip} />

				<!-- See Learn's copy of this: the bar's slot is a sibling so the board's
				     container-height sizing isn't fed its width. -->
				<div
					class="w-full flex items-start justify-center gap-2 lg:flex-1 lg:min-h-0 lg:[container-type:size]"
				>
					<!-- The bar's slot is always here and only its contents change: the
					     bar while exploring with the engine switched on, nothing the rest
					     of the time. Mounting the slot conditionally instead moved the
					     board every time explore opened or closed — 20px sideways on
					     desktop, and a 40px resize on mobile, where the board is width-
					     constrained and the control row is capped to its width. Same rule
					     as #113's status strip: reserve the space, vary the contents. -->
					<div class="w-8 shrink-0">
						{#if explore.active && engineEnabled.on}
							<EvalBar
								fen={displayFen}
								orientation={data.repertoire?.color === 'black' ? 'black' : 'white'}
								height={boardWidth}
							/>
						{/if}
					</div>
					<ChessBoard
						fen={displayFen}
						orientation={data.repertoire?.color === 'black' ? 'black' : 'white'}
						interactable={explore.active || (!locked && !isReviewing)}
						onmove={handleBoardMove}
						prefs={data.boardPrefs}
						hintSquare={explore.active ? null : hintSquare}
						arrowMove={null}
						containerFit
						bind:boxWidth={boardWidth}
					/>
				</div>

				{#if explore.active}
					<!-- The review nav counts drill plies, and none of these are drill
					     plies, so the excursion's own controls take its place. -->
					<div
						class="grid grid-cols-3 gap-2 mt-4 shrink-0 mx-auto w-full"
						style={boardWidth ? `max-width: ${boardWidth}px` : ''}
					>
						<button
							onclick={() => explore.undo()}
							disabled={explore.depth === 0}
							class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-xs sm:text-sm font-semibold text-(--color-text) disabled:opacity-30"
						>
							↶ Undo
						</button>
						<EngineToggle />
						<button
							onclick={stopExplore}
							class="py-2 rounded-xl border border-amber-300 bg-amber-50 text-xs sm:text-sm font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
						>
							{exploringDemoted ? '→ Next line' : '↩ Back to the line'}
						</button>
					</div>
				{:else}
					<MoveNavRow
						{reviewIdx}
						totalPlies={steps.length}
						reviewMoves={playerMovesIn(steps, reviewIdx)}
						totalMoves={playerMovesIn(steps, steps.length)}
						{isReviewing}
						{boardWidth}
						onstart={reviewToStart}
						onback={reviewBack}
						onforward={reviewForward}
						onlive={reviewToLive}
					/>
					{#if canExplore}
						<p class="text-center mt-2 shrink-0">
							<button
								onclick={startExplore}
								class="inline-flex items-center gap-1.5 text-sm font-medium text-(--color-muted) hover:text-(--color-text)"
							>
								<span aria-hidden="true">🔍</span> Explore this position
							</button>
						</p>
					{:else if strip === 'demoted' && current}
						<!-- The one moment a player most wants to look around, and the one
						     the drill was about to take away 1.6s later (#131). Taking it
						     cancels that advance; the outcome is already reported either
						     way, so nothing about the record changes. -->
						<p class="text-center mt-2 shrink-0">
							<button
								onclick={exploreDemoted}
								class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 hover:underline"
							>
								<span aria-hidden="true">🔍</span> See why
							</button>
						</p>
					{/if}
				{/if}
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

				<div class="p-4 flex flex-col gap-2">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted)">Stuck?</p>
					<button
						onclick={requestHint}
						disabled={hintRequested || explore.active}
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
