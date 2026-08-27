<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import EvalBar from '$lib/components/EvalBar.svelte';
	import ExploreControls from '$lib/components/ExploreControls.svelte';
	import { engineEnabled } from '$lib/engine/engine.svelte';
	import MoveList from '$lib/components/MoveList.svelte';
	import MoveNavRow from '$lib/components/MoveNavRow.svelte';
	import PracticeStatusStrip from '$lib/components/PracticeStatusStrip.svelte';
	import RepertoireUpdatedBanner from '$lib/components/RepertoireUpdatedBanner.svelte';
	import type { Key } from 'chessground/types';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { moveSequenceRows, type VariationStep } from '$lib/mastery/variations';
	import { positionAt, playerMovesIn, hintSquareFor, makeReviewNav, makeReviewKeyHandler } from '$lib/mastery/playback';
	import { logMove } from '$lib/moveLog';
	import { ExploreSession } from '$lib/mastery/explore.svelte';
	import { PracticeDrill } from '$lib/mastery/practiceDrill.svelte';
	import { m } from '$lib/paraglide/messages';

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
	let sessionPassed = $state(0);
	let sessionDemoted = $state(0);
	let boardWidth = $state(0);
	let manualReviewIdx = $state<number | null>(null);
	// Explore mode (#125), the same scratch board Learn has and the same module
	// behind it: it owns only its own position, so an excursion cannot touch the
	// drill's ply/board/outcome state — which matters more here than on Learn,
	// where a stray mistake only costs a clean pass. In Practice it would demote
	// the line.
	const explore = new ExploreSession();
	// True when the excursion was opened FROM a demoted line (#131): the line is
	// already reported and finished, so leaving the excursion moves on to the next
	// one instead of returning to a board that was about to disappear.
	let exploringDemoted = $state(false);

	const current = $derived(queue[queueIdx] ?? null);
	const steps = $derived(current?.path ?? []);
	const finished = $derived(queue.length > 0 && queueIdx >= queue.length);

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

	function advanceToNextLine() {
		queueIdx++;
		startCurrent();
	}

	// The current line's drill state machine (#97/#98/#103/#113/#125/#131) —
	// everything about playing THIS line out, extracted to
	// $lib/mastery/practiceDrill.svelte.ts. This page composes it with the queue
	// (above), Explore (below), and review navigation, the same way it already
	// composed with ExploreSession.
	const drill = new PracticeDrill({
		onOutcome: (outcome) => {
			if (outcome === 'clean') sessionPassed++;
			else sessionDemoted++;
			report(outcome);
		},
		onAdvance: advanceToNextLine
	});

	const reviewIdx = $derived(manualReviewIdx ?? drill.plyIdx);
	const isReviewing = $derived(manualReviewIdx !== null);
	const moveRows = $derived(moveSequenceRows(steps.slice(0, drill.plyIdx)));

	const drillFen = $derived(isReviewing ? positionAt(steps, reviewIdx, drill.boardFen) : drill.boardFen);
	// The explored position while off-book, the drill's own otherwise. The eval bar
	// reads the same value, so it answers for whatever is actually on the board —
	// and the bar only exists in explore mode with the engine switched on, so the
	// local engine spawns there and nowhere else.
	const displayFen = $derived(explore.active ? explore.fen : drillFen);
	// Only while the drill is genuinely waiting for a move. `locked` covers both
	// the correct-move hold and the 1.6s window after a wrong move, when the line
	// is already demoted and about to be replaced.
	const canExplore = $derived(!!current && !drill.locked && !isReviewing && !!drillFen);

	// Taking it has already cost the line its learned status, so there is
	// nothing further for the hint to protect.
	const hintSquare = $derived(hintSquareFor(steps, drill.plyIdx, drill.hintRequested, isReviewing));

	function startCurrent() {
		explore.stop();
		exploringDemoted = false;
		manualReviewIdx = null;
		drill.start(steps);
	}

	// Set the first position synchronously — ChessBoard's onMount throws on an
	// empty FEN.
	startCurrent();

	function requestHint() {
		if (!drill.requestHint()) return;
		// Same reason as Learn's: hintSquare is null while reviewing, so a hint
		// taken from a stepped-back position demoted the line and drew nothing.
		manualReviewIdx = null;
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
		drill.cancelPendingAdvance();
		exploringDemoted = true;
		explore.start(drill.mistakeFen ?? drill.boardFen);
	}

	/**
	 * Leaves explore mode. Nothing to restore: the drill's state was never handed
	 * over, and `drill.strip` is read directly below rather than overwritten, so
	 * whatever message was up comes back on its own.
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
			advanceToNextLine();
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
		if (isReviewing) return false;
		const result = drill.attemptMove(detail.from, detail.to, detail.san);
		if (!result) return false;
		if (result.correct) {
			playCorrect();
			logMove(data.repertoire?.id, result.moveId, detail.san, true);
		} else {
			playWrong();
			logMove(data.repertoire?.id, result.moveId, detail.san, false);
		}
		return result.correct;
	}

	const { reviewToStart, reviewBack, reviewForward, reviewToLive } = makeReviewNav({
		get: () => manualReviewIdx,
		set: (v) => (manualReviewIdx = v),
		reviewIdx: () => reviewIdx,
		liveIdx: () => drill.plyIdx
	});

	// Not while exploring: the arrows step through drill plies, and none of the
	// explored moves are drill plies.
	const handleKeydown = makeReviewKeyHandler({
		reviewToStart,
		reviewBack,
		reviewForward,
		reviewToLive,
		isEnabled: () => !!current && !explore.active
	});
</script>

<svelte:head>
	<!-- Fallback name reused verbatim from Learn's per-repertoire page. -->
	<title>{m.seo_practice_repertoire_title({ name: data.repertoire?.name ?? m.learn_repertoire_fallback_name() })}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<main
	class="min-h-screen lg:min-h-0 lg:h-[calc(100vh-4rem)] lg:overflow-hidden bg-(--color-bg) p-4 max-w-7xl mx-auto pb-24 lg:pb-4 flex flex-col"
>
	<div class="mb-3 flex items-center gap-3 shrink-0 flex-wrap">
		<a href="/practice" class="text-(--color-muted) text-sm hover:text-(--color-text)">{m.practice_all_repertoires_link()}</a>
		<h1 class="text-base font-bold text-(--color-text) flex-1 min-w-0 truncate">{data.repertoire?.name}</h1>
		<a
			href="/practice/{data.repertoire?.id}/mastery"
			class="text-xs font-semibold text-(--color-accent) border border-(--color-border) rounded-lg px-2 py-1 hover:bg-(--color-border)/40"
		>
			{m.practice_levels_link()}
		</a>
		<a
			href="/learn/{data.repertoire?.id}"
			class="text-xs font-semibold text-(--color-muted) border border-(--color-border) rounded-lg px-2 py-1 hover:bg-(--color-border)/40"
		>
			{m.practice_learn_mode_link()}
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
			<h2 class="text-2xl font-bold text-(--color-text)">{m.practice_empty_nothing_learned_title()}</h2>
			<p class="text-(--color-muted) max-w-md">
				{m.practice_empty_nothing_learned_body()}
			</p>
			<a
				href="/learn/{data.repertoire?.id}"
				class="bg-(--color-accent) text-white px-6 py-3 rounded-2xl font-bold hover:bg-(--color-accent-hover) transition"
			>
				{m.practice_go_to_learn()}
			</a>
		</div>
	{:else if queue.length === 0}
		<!-- learnedCount > 0 here, but no whole chapter is finished yet — a lone
		     learned line inside an unfinished chapter doesn't unlock Practice for
		     it (see +page.server.ts's fullyLearnedChapters gate). -->
		<div class="flex flex-col items-center justify-center lg:flex-1 text-center gap-4 py-16">
			<p class="text-6xl">📖</p>
			<h2 class="text-2xl font-bold text-(--color-text)">{m.practice_empty_finish_chapter_title()}</h2>
			<p class="text-(--color-muted) max-w-md">
				{m.practice_finish_chapter_body({ count: data.learnedCount })}
			</p>
			<a
				href="/learn/{data.repertoire?.id}"
				class="bg-(--color-accent) text-white px-6 py-3 rounded-2xl font-bold hover:bg-(--color-accent-hover) transition"
			>
				{m.practice_go_to_learn()}
			</a>
		</div>
	{:else if finished}
		<div class="flex flex-col items-center justify-center lg:flex-1 text-center gap-4 py-16">
			<p class="text-6xl">{sessionDemoted === 0 ? '🎯' : '📚'}</p>
			<h2 class="text-2xl font-bold text-(--color-text)">{m.practice_session_complete_title()}</h2>
			<p class="text-(--color-muted)">
				{m.practice_session_held_up_count({ count: sessionPassed })}{sessionDemoted > 0 ? m.practice_session_demoted_suffix({ count: sessionDemoted }) : ''}.
			</p>
			{#if sessionDemoted > 0}
				<a
					href="/learn/{data.repertoire?.id}"
					class="bg-(--color-accent) text-white px-6 py-3 rounded-2xl font-bold hover:bg-(--color-accent-hover) transition"
				>
					{m.practice_relearn_button({ count: sessionDemoted })}
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
				{m.practice_again_button()}
			</button>
		</div>
	{:else}
		<div class="flex flex-col lg:flex-row lg:items-stretch gap-6 lg:flex-1 lg:min-h-0">
			<div class="lg:flex-1 lg:flex lg:flex-col lg:min-h-0 lg:items-start">
				<!-- Explore wins the strip outright while it lasts: every other message
				     would be describing a position that isn't on screen. Read from the
				     drill directly rather than a copy, so its real value survives the
				     excursion untouched. -->
				<PracticeStatusStrip state={explore.active ? 'exploring' : drill.strip} />

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
						interactable={explore.active || (!drill.locked && !isReviewing)}
						onmove={handleBoardMove}
						prefs={data.boardPrefs}
						hintSquare={explore.active ? null : hintSquare}
						arrowMove={null}
						containerFit
						bind:boxWidth={boardWidth}
					/>
				</div>

				<!-- Mobile only (#166): desktop gets the same controls pinned to the
				     sidebar's bottom edge instead, so the board column can grow to
				     fill the space this used to occupy. See
				     2026-08-26-drill-sidebar-nav-design.md. -->
				<div class="lg:hidden">
					{#if explore.active}
						<ExploreControls
							depth={explore.depth}
							onundo={() => explore.undo()}
							onstop={stopExplore}
							stopLabel={exploringDemoted
								? `→ ${m.practice_explore_next_line()}`
								: m.explore_controls_back_to_line()}
							{boardWidth}
						/>
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
							onExplore={startExplore}
							exploreDisabled={!canExplore}
						/>
						{#if drill.strip === 'demoted' && current}
							<!-- The one moment a player most wants to look around, and the
							     one the drill was about to take away 1.6s later (#131).
							     Taking it cancels that advance; the outcome is already
							     reported either way, so nothing about the record changes. -->
							<p class="text-center mt-2 shrink-0">
								<button
									onclick={exploreDemoted}
									class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 hover:underline"
								>
									<span aria-hidden="true">🔍</span> {m.practice_explore_see_why()}
								</button>
							</p>
						{/if}
					{/if}
				</div>
			</div>

			<aside
				class="w-full lg:w-80 lg:shrink-0 hidden lg:flex lg:flex-col divide-y divide-(--color-border) bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm lg:overflow-y-auto"
			>
				<div class="p-4 flex flex-col gap-2">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted)">{m.practice_this_session_heading()}</p>
					<p class="text-sm text-(--color-text) tabular-nums">
						{m.practice_session_line_progress({ current: Math.min(queueIdx + 1, queue.length), total: queue.length })}
					</p>
					<div class="h-1.5 rounded-full bg-(--color-border) overflow-hidden">
						<div
							class="h-full bg-(--color-accent) rounded-full"
							style={`width: ${queue.length ? (queueIdx / queue.length) * 100 : 0}%`}
						></div>
					</div>
					<p class="text-xs text-(--color-muted)">
						{m.practice_session_held_up_count({ count: sessionPassed })} · {m.practice_sidebar_demoted_count({ count: sessionDemoted })}
					</p>
				</div>

				<div class="p-4 flex flex-col gap-1">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted)">{m.learn_this_line_heading()}</p>
					{#if current?.chapterNames?.length}
						<p class="text-sm text-(--color-text) font-medium">{current.chapterNames.join(' · ')}</p>
					{/if}
					<MoveList rows={moveRows} />
				</div>

				<div class="p-4 flex flex-col gap-2">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted)">{m.learn_stuck_heading()}</p>
					<button
						onclick={requestHint}
						disabled={drill.hintRequested || explore.active}
						class="self-start inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400 border border-amber-400/40 bg-amber-400/10 rounded-lg px-2.5 py-1.5 disabled:opacity-40"
					>
						<span aria-hidden="true">💡</span> {m.practice_show_hint()}
					</button>
					<p class="text-xs text-(--color-muted)">
						{m.practice_hint_description()}
					</p>
					<p class="text-xs text-(--color-muted)">{m.practice_keyboard_hint()}</p>
				</div>

				<div class="p-4">
					<a href="/practice" class="text-sm text-(--color-muted) hover:text-(--color-text)">{m.learn_finish_session()}</a>
				</div>

				<!-- Desktop-only nav row footer (#166): pinned to the sidebar's
				     bottom edge, matching chess.com's stacking of an actions area
				     above a nav-arrows row flush at the bottom. Mobile keeps its own
				     copy directly under the board (above). No boardWidth here — the
				     sidebar is already a fixed width, so nothing needs capping. -->
				<div class="hidden lg:flex lg:flex-col p-4 mt-auto">
					{#if explore.active}
						<ExploreControls
							depth={explore.depth}
							onundo={() => explore.undo()}
							onstop={stopExplore}
							stopLabel={exploringDemoted
								? `→ ${m.practice_explore_next_line()}`
								: m.explore_controls_back_to_line()}
						/>
					{:else}
						<MoveNavRow
							{reviewIdx}
							totalPlies={steps.length}
							reviewMoves={playerMovesIn(steps, reviewIdx)}
							totalMoves={playerMovesIn(steps, steps.length)}
							{isReviewing}
							onstart={reviewToStart}
							onback={reviewBack}
							onforward={reviewForward}
							onlive={reviewToLive}
							onExplore={startExplore}
							exploreDisabled={!canExplore}
						/>
						{#if drill.strip === 'demoted' && current}
							<p class="text-center mt-2 shrink-0">
								<button
									onclick={exploreDemoted}
									class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 hover:underline"
								>
									<span aria-hidden="true">🔍</span> {m.practice_explore_see_why()}
								</button>
							</p>
						{/if}
					{/if}
				</div>
			</aside>
		</div>
	{/if}
</main>
