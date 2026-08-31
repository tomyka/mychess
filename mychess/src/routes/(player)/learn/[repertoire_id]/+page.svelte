<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import VariationPicker from '$lib/components/VariationPicker.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { Key } from 'chessground/types';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { optimisticSolvedAfterAttempt, type PracticeView } from '$lib/mastery/practice';
	import { arrowMoveForStep } from '$lib/mastery/teaching';
	import { moveSequenceLabel, moveSequenceRows, type VariationStep } from '$lib/mastery/variations';
	import { positionAt, playerMovesIn, hintSquareFor, makeReviewNav, makeReviewKeyHandler } from '$lib/mastery/playback';
	import { logMove } from '$lib/moveLog';
	import { ExploreSession } from '$lib/mastery/explore.svelte';
	import { LearnDrill, CUE_HOLD_MS } from '$lib/mastery/learnDrill.svelte';
	import EvalBar from '$lib/components/EvalBar.svelte';
	import ExploreControls from '$lib/components/ExploreControls.svelte';
	import { engineEnabled } from '$lib/engine/engine.svelte';
	import MoveList from '$lib/components/MoveList.svelte';
	import MoveNavRow from '$lib/components/MoveNavRow.svelte';
	import PracticeStatusStrip, { type PracticeStripState } from '$lib/components/PracticeStatusStrip.svelte';

	let { data } = $props<{ data: any }>();

	// How many variations have been solved cleanly since this page loaded —
	// deliberately NOT reset on an attempt reset: a running session total,
	// not per-attempt state.
	let learnedThisSession = $state(0);
	// Snapshot of data.solved at mount, NOT reactive: the denominator for the
	// sidebar's session bar is "how much of what was left to learn got covered
	// this sitting", which needs a value that stays put while data.solved
	// climbs across the session — a $derived over data.solved would move the
	// goalposts with every attempt instead of measuring progress against them.
	const sessionStartSolved = data.solved;
	// Whether the "now play it from memory" cue is currently up. A clean teach
	// pass is followed by a blind retest of the very same moves, which used to
	// look like the board silently rewinding itself for no reason — the cue is
	// what makes that reset read as the intentional test it is. Deliberately
	// NOT reset by the drill: it exists precisely to bridge two attempts, so
	// tying its lifetime to the drill's own reset would hide it exactly when
	// it's needed. Cleared only by a player-initiated jump elsewhere (variation
	// switch / repertoire change), where the cue would be talking about a line
	// they just left.
	let teachCue = $state(false);
	let cueTimeout: ReturnType<typeof setTimeout> | undefined;
	// CUE_HOLD_MS is the drill's own phase='transition' wait, imported from
	// learnDrill.svelte.ts so the two stay in lockstep; CUE_LINGER_MS is purely
	// how much longer the cue overlay stays up OVER the freshly reset board.
	const CUE_LINGER_MS = 1800;
	// Bumped on every resetForAttempt() call so a stale in-flight nextAttempt()
	// notices it's been superseded and stops writing to state.
	let resetToken = 0;
	let pendingReport: Promise<PracticeView | null> | null = null;
	let quizSteps = $state<VariationStep[]>([]);
	let pickerOpen = $state(false);
	// Set when a POST to /api/practice/select-variation fails (tier lock,
	// exclusion drift, network hiccup) — surfaced to the player instead of
	// silently leaving the board on whatever was already being taught, which
	// used to look exactly like "selecting a variation does nothing" (GitHub
	// issue #170). Cleared on the next successful selection.
	let selectError = $state<string | null>(null);
	// The board's own actual rendered width (bound from ChessBoard) — the
	// move-nav row below it is capped to match, since on desktop the board
	// is height-constrained (containerFit) and often narrower than its
	// column, so a plain full-width row would otherwise end up wider than
	// the board itself.
	let boardWidth = $state(0);
	// null means "following the live position" (quizIdx) — set to a concrete
	// ply count while the player is browsing back through THIS attempt's
	// already-played moves with the mobile move-nav row. Review-only: it
	// never lets the player look past quizIdx (nothing further has been
	// played yet), and the board is non-interactable while it's non-null —
	// stepping back doesn't undo anything, it's just a look back.
	let manualReviewIdx = $state<number | null>(null);
	// Explore mode (#125): a scratch board opened ON TOP of the drill, never
	// instead of it. It owns nothing but its own position, which is what makes
	// "an excursion changes no drill state" true by construction rather than by
	// remembering to restore things — see explore.svelte.ts.
	const explore = new ExploreSession();

	// The current attempt's drill state machine — ply position, phase, lock,
	// hint, and mistake bookkeeping — extracted to
	// $lib/mastery/learnDrill.svelte.ts. This page composes it with the async
	// report/nextAttempt cycle, the teach-cue overlay, review navigation, and
	// Explore, the same way it already composed with ExploreSession. Declared
	// before the deriveds below reference it.
	const drill = new LearnDrill({
		onFinalMove: (hadMistake) => {
			if (!attempt) return;
			pendingReport = reportAttempt(attempt.variationKey, hadMistake);
			// Bump the sidebar count immediately rather than waiting for the
			// round trip above to resolve — it re-walks the whole repertoire's
			// move tree to advance the active variation, which can take a
			// real, noticeable moment for a large repertoire. nextAttempt()
			// overwrites this with the server's authoritative value once
			// pendingReport resolves. Only a FINAL pass can actually learn the
			// variation — a clean teach pass or an intermediate blind-retest
			// pass hasn't finished it yet, so it must not bump the count.
			if (attempt.isFinalPass) {
				data = { ...data, solved: optimisticSolvedAfterAttempt(data, hadMistake) };
				if (!hadMistake) learnedThisSession++;
			}
		},
		onCueRetest: () => showTeachCue(),
		onAttemptFinished: () => nextAttempt()
	});

	const attempt = $derived(data.attempt);
	const repertoireId = $derived(data.repertoire?.id);
	const reviewIdx = $derived(manualReviewIdx ?? drill.quizIdx);
	const isReviewing = $derived(manualReviewIdx !== null);
	// How much of what was left to learn at the start of this sitting has been
	// covered since — the sidebar's second progress bar. Clamped to 1: solving
	// something demoted back in by a coach update mid-session (rare, but
	// possible) could otherwise push the count past its own denominator.
	const sessionRatio = $derived(
		Math.min(1, learnedThisSession / Math.max(1, data.total - sessionStartSolved))
	);


	// boardFen is used at the live position rather than positionAt(quizIdx) —
	// the two always agree, but boardFen is what the 500ms correct-move hold
	// (see the drill's attemptMove) intentionally delays updating, so deriving
	// from it keeps that timing intact instead of jumping the board early.
	const drillFen = $derived(isReviewing ? positionAt(quizSteps, reviewIdx, drill.boardFen) : drill.boardFen);
	// What the board actually renders: the explored position while off-book, the
	// drill's own otherwise. The eval bar follows the same value, so it answers
	// for whatever is on the board.
	const displayFen = $derived(explore.active ? explore.fen : drillFen);
	// Offered only while the drill is genuinely waiting for a move: during the
	// autoplay intro, the correct-move hold, or a review of earlier plies,
	// "the position" is ambiguous or about to change under the excursion.
	const canExplore = $derived(drill.phase === 'playing' && !drill.locked && !isReviewing && !!drillFen);

	// Plain-text move list for the mobile eval panel (Lichess-style), e.g.
	// "1.e4 e5 2.Nf3 Nc6" — every move actually played so far in this
	// attempt, independent of manualReviewIdx (browsing back to look at an
	// earlier position doesn't shrink the list).
	const movesSoFar = $derived(drill.quizIdx > 0 ? moveSequenceLabel(quizSteps.slice(0, drill.quizIdx)) : '');
	const moveRows = $derived(moveSequenceRows(quizSteps.slice(0, drill.quizIdx)));

	const { reviewToStart, reviewBack, reviewForward, reviewToLive } = makeReviewNav({
		get: () => manualReviewIdx,
		set: (v) => (manualReviewIdx = v),
		reviewIdx: () => reviewIdx,
		liveIdx: () => drill.quizIdx
	});

	// Ignored while the variation picker is open (it doesn't use arrow keys
	// itself, but the board underneath shouldn't react while a modal is up),
	// not while exploring (the arrows step through drill plies, and none of
	// the explored moves are drill plies), or when there's nothing loaded.
	const handleKeydown = makeReviewKeyHandler({
		reviewToStart,
		reviewBack,
		reviewForward,
		reviewToLive,
		isEnabled: () => !pickerOpen && !!attempt && !explore.active
	});

	// Taken has already cost this pass its clean-solve eligibility, so there
	// is nothing further for the hint to protect.
	const hintSquare = $derived(hintSquareFor(quizSteps, drill.quizIdx, drill.hintRequested, isReviewing));

	// The current ply's teaching arrow, if this attempt is a teach pass and
	// we're standing on one of its plies — see arrowMoveForStep for the
	// player-turn/ply-range/parse-failure guards. Suppressed while reviewing
	// an earlier position: the arrow points at the move due at the LIVE ply,
	// which would land on the wrong square (or no piece at all) if drawn over
	// a past position instead.
	const arrowMove = $derived.by(() => {
		if (isReviewing) return null;
		const step = quizSteps[drill.quizIdx];
		if (!step) return null;
		return arrowMoveForStep(step, drill.quizIdx, attempt?.arrowPlies ?? null);
	});

	// Whether to offer a hint at all. Not on an arrowed ply: the move is already
	// drawn on the board there, so offering to point at the piece is noise on a
	// move the player was never asked to recall.
	const hintOffered = $derived(drill.phase === 'playing' && !drill.hintRequested && !arrowMove && !explore.active);

	// Priority: a teaching arrow is self-explanatory (silent) > the
	// between-passes cue > the last move's own result > the autoplay intro
	// > the default blind-retest prompt.
	const stripState = $derived.by((): PracticeStripState => {
		// Explore wins outright: while the board is off-book, every other message
		// would be describing a position that isn't on screen.
		if (explore.active) return 'exploring';
		if (arrowMove) return 'silent';
		if (teachCue) return 'retest-cue';
		if (drill.phase === 'advancing') return 'correct';
		if (drill.lastMoveResult === 'wrong') return 'wrong';
		if (drill.lastMoveResult === 'correct') return 'correct';
		if (drill.phase === 'autoplay') return 'autoplay';
		return 'blind';
	});

	/**
	 * Raises the between-passes cue and keeps it up across the board reset that
	 * follows. Its timeout is deliberately NOT cleared when a new attempt
	 * starts — every bit of the drill's own state is per-attempt, but this one
	 * exists precisely to bridge two attempts, so tying its lifetime to the
	 * drill's reset would hide it exactly when it's needed. It's cleared only
	 * by a player-initiated jump elsewhere (variation switch / repertoire
	 * change), where the cue would be talking about a line they just left.
	 */
	function showTeachCue() {
		clearTimeout(cueTimeout);
		teachCue = true;
		cueTimeout = setTimeout(() => (teachCue = false), CUE_HOLD_MS + CUE_LINGER_MS);
	}

	function clearTeachCue() {
		clearTimeout(cueTimeout);
		teachCue = false;
	}

	function resetForAttempt() {
		++resetToken;
		quizSteps = attempt?.path ?? [];
		// autoPlayThrough covers whatever's already mastered — either by THIS
		// variation's own earlier progress, or by a SIBLING variation sharing
		// the same leading moves (see computeMasteredMoveIds) — so it applies
		// during a blind retest too, not just a teach pass: content that's
		// genuinely already known plays itself out instead of making the
		// player re-enter it by hand every time a variation happens to share
		// it. 0 for an already-solved variation's own re-drill, where full
		// manual replay is the point.
		//
		// cueRetestEligible: a clean teach pass is about to be re-served as a
		// blind retest of the same moves: same length, same start, arrows
		// gone. That's announced (issue #68) before the drill's own reset, or
		// it just looks like the board threw the player's work away and
		// started over. A final pass (which solves the variation) and a pass
		// with a mistake in it (which re-serves the identical teach pass,
		// arrows and all) both mean something else, so neither is eligible.
		drill.start(quizSteps, {
			autoPlayThrough: attempt?.autoPlayThrough ?? 0,
			cueRetestEligible: !!attempt?.arrowPlies && !attempt?.isFinalPass
		});
		manualReviewIdx = null;
	}

	// Set the board's initial position synchronously, before ChessBoard's own
	// onMount runs — it throws on an empty FEN.
	resetForAttempt();

	// Reset when the REPERTOIRE changes (including on mount) — not on every
	// `attempt` change, since nextAttempt() below also changes `attempt` via
	// invalidateAll()/a merged report and calls resetForAttempt() itself once
	// it's ready.
	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- deliberate Svelte dependency-tracking read
		repertoireId;
		untrack(() => {
			clearTeachCue();
			selectError = null;
			resetForAttempt();
		});
	});

	function startExplore() {
		if (!canExplore) return;
		explore.start(drillFen);
	}

	/**
	 * Leaves explore mode. Nothing is restored because nothing was handed over:
	 * the drill's own state was never touched, so it simply becomes visible
	 * again exactly as it was.
	 */
	function stopExplore() {
		explore.stop();
	}

	/**
	 * The board's ONE move handler, for both modes. Swapping the `onmove` prop
	 * between two functions works too (ChessBoard rebuilds its chessground config
	 * when its props change, and a test drove a full excursion both ways to
	 * confirm), but dispatching at call time doesn't depend on WHEN that rebuild
	 * happens — it can't route a drill move to a dead excursion however the
	 * config is refreshed.
	 */
	function handleBoardMove(detail: { from: Key; to: Key; san: string }) {
		if (explore.active) return explore.play(detail.from, detail.to);
		return handleMove(detail);
	}

	function requestHint() {
		// Snap back to the live position first: hintSquare is deliberately null
		// while reviewing (the ring would land on a past position's piece), so
		// without this a hint taken while browsing back marked the attempt dirty
		// and drew nothing at all — the tap did nothing visible. The hint is
		// about the move due NOW, so going live is also where the player has to
		// end up anyway.
		manualReviewIdx = null;
		drill.requestHint();
	}

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		const result = drill.attemptMove(detail.from, detail.to, detail.san);
		if (!result) return false;
		if (result.correct) {
			playCorrect();
			logMove(repertoireId, result.moveId, detail.san, true);
			return result.isFinalMove ? 'final' : true;
		}
		playWrong();
		logMove(repertoireId, result.moveId, detail.san, false);
		return false;
	}

	// One session row per visit (#103): set on the first attempt reported and
	// never again, so a session means a sitting rather than a move.
	let sessionReported = false;

	async function reportAttempt(variationKey: string, hadMistake: boolean): Promise<PracticeView | null> {
		const sessionStart = !sessionReported;
		sessionReported = true;
		try {
			const res = await fetch('/api/practice/attempt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId, variationKey, hadMistake, sessionStart })
			});
			if (!res.ok) return null;
			return await res.json();
		} catch {
			return null;
		}
	}


	async function nextAttempt() {
		const myToken = resetToken;
		const view = pendingReport ? await pendingReport : null;
		pendingReport = null;
		if (myToken !== resetToken) return; // superseded by a resetForAttempt() while we were awaiting

		if (view) {
			data = { ...data, ...view };
		} else {
			await invalidateAll();
			if (myToken !== resetToken) return;
		}
		resetForAttempt();
	}

	/**
	 * The shared core of both selection paths below: posts the pick, merges
	 * the returned PracticeView into `data`, and resets the drill onto it.
	 * Neither closes the picker nor is itself exposed as an `onselect` —
	 * that decision belongs to the two thin wrappers, since picking a chapter
	 * (start teaching a representative, stay browsable) and picking a specific
	 * variation (start teaching it, done choosing) mean different things for
	 * whether the picker should close.
	 */
	async function applyVariationSelection(variationKey: string) {
		clearTeachCue();
		try {
			const res = await fetch('/api/practice/select-variation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId, variationKey })
			});
			if (!res.ok) {
				// A 403 means the server's own tier-ceiling gate rejected this pick
				// (see select-variation's doc comment) — distinct from a generic
				// failure, since "try again" is misleading here: retrying won't
				// help until the current tier is actually cleared.
				selectError = res.status === 403 ? m.learn_select_variation_locked() : m.learn_select_variation_error();
				return;
			}
			selectError = null;
			data = { ...data, ...(await res.json()) };
			resetForAttempt();
		} catch {
			selectError = m.learn_select_variation_error();
		}
	}

	/** A specific variation was picked from the list — teach it, and the picker's job is done. */
	async function selectVariation(variationKey: string) {
		pickerOpen = false;
		await applyVariationSelection(variationKey);
	}

	/** A chapter heading was picked — teach its representative variation, but leave the picker open so the player can still drill into a more specific one. */
	async function selectChapterRepresentative(variationKey: string) {
		await applyVariationSelection(variationKey);
	}
</script>

<svelte:head>
	<title>{m.seo_learn_repertoire_title({ name: data.repertoire?.name ?? m.learn_repertoire_fallback_name() })}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<main
	class="min-h-screen lg:min-h-0 lg:h-[calc(100vh-4rem)] lg:overflow-hidden bg-(--color-bg) p-4 max-w-7xl mx-auto pb-24 lg:pb-4 flex flex-col"
	data-phase={drill.phase}
>
	<div class="mb-3 flex items-center justify-between gap-3 shrink-0">
		<a href="/practice" class="text-(--color-muted) text-sm hover:text-(--color-text) shrink-0">{m.learn_all_repertoires_link()}</a>
		{#if data.repertoire?.name}
			<h1 class="text-(--color-text) font-bold text-base sm:text-lg truncate text-center flex-1 min-w-0">
				{data.repertoire.name}
			</h1>
		{/if}
		{#if repertoireId}
			<button
				onclick={() => (pickerOpen = true)}
				class="lg:hidden inline-flex items-center gap-1 text-(--color-accent) text-sm font-medium hover:underline shrink-0"
			>
				<span aria-hidden="true">📖</span> {m.learn_switch_variation()}
			</button>
		{/if}
	</div>

	<!-- `!attempt` is load-bearing: re-drilling from the solved screen keeps
	     `allSolved` true (picking a variation deliberately doesn't un-solve
	     anything), and the server signals the re-drill by returning a real
	     `attempt` anyway — `/api/practice/select-variation` passes
	     `forceAttempt: true`, which makes `buildPracticeView` build an attempt
	     despite the repertoire being complete. Without this guard the solved
	     screen kept winning the branch, so "Re-drill a specific variation"
	     closed the picker and appeared to do nothing. -->
	{#if data.allSolved && data.total > 0 && !attempt}
		<div class="flex flex-col items-center gap-6 text-center py-16">
			<p class="text-7xl">🎓</p>
			<h2 class="text-3xl font-bold text-(--color-text)">{m.learn_repertoire_learned_title()}</h2>
			<p class="text-(--color-muted)">
				{m.learn_repertoire_learned_body({ name: data.repertoire?.name })}
			</p>
			<a
				href="/practice/{data.repertoire?.id}"
				class="bg-(--color-accent) text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-(--color-accent-hover) transition"
			>
				{m.learn_practice_this_repertoire()}
			</a>
			<button onclick={() => (pickerOpen = true)} class="text-(--color-accent) hover:underline">
				{m.learn_redrill_variation()}
			</button>
		</div>
	{:else if !attempt}
		<div class="flex flex-col items-center justify-center min-h-screen lg:min-h-0 lg:flex-1 text-center gap-4">
			<p class="text-5xl">📭</p>
			<h2 class="text-2xl font-bold text-(--color-text)">{m.learn_nothing_to_learn_title()}</h2>
			<p class="text-(--color-muted)">{m.learn_no_moves_body()}</p>
			<a href="/practice" class="text-(--color-accent) hover:underline">{m.learn_back_to_repertoires()}</a>
		</div>
	{:else}
		<div class="p-3 bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm text-center mb-3 shrink-0 lg:hidden">
			<p class="text-sm font-bold text-(--color-text)">{m.learn_progress_count({ solved: data.solved, total: data.total })}</p>
		</div>

		<div class="flex flex-col lg:flex-row lg:items-stretch gap-6 lg:flex-1 lg:min-h-0">
			<!-- Permanent desktop rail (GitHub issue #93): replaces the modal
			     picker's role there entirely, so the sidebar's own "Switch"
			     button (further down) is gone rather than duplicating it. Mobile
			     keeps the modal, opened from the top bar's "Switch variation"
			     button — no viewport width here for a third column. -->
			{#if repertoireId}
				<div class="hidden lg:flex lg:w-64 lg:shrink-0 lg:min-h-0">
					<VariationPicker
						{repertoireId}
						onselect={selectVariation}
						onselectchapter={selectChapterRepresentative}
						variant="inline"
						currentVariationKey={attempt?.variationKey ?? null}
					/>
				</div>
			{/if}

			<div class="lg:flex-1 lg:flex lg:flex-col lg:min-h-0">
				<!-- Sits directly above the board in both layouts, so it's in the
				     same place the player is already looking. role="status" (an
				     implicit aria-live="polite" region) announces it on appearance:
				     it's the only signal that e.g. the board is about to rewind, and
				     nothing about the board itself conveys that. -->
				<!-- The mobile hint offer lives INSIDE the strip (see its own doc
				     comment): as its own row below the strip it mounted and
				     unmounted on every phase change and moved the board with it
				     (#113). Passing the callback only while the offer actually
				     stands is what makes the strip hand the slot over. -->
				<PracticeStatusStrip state={stripState} onhint={hintOffered ? requestHint : undefined} />

				<!-- A failed variation switch (tier lock, exclusion drift, network)
				     used to leave the board on whatever was already being taught with
				     zero feedback — indistinguishable from "selecting does nothing"
				     (GitHub issue #170). role="alert" so it's announced immediately,
				     unlike the status strip's role="status" above. -->
				{#if selectError}
					<p role="alert" class="text-sm text-red-600 dark:text-red-400 text-center mb-2">{selectError}</p>
				{/if}

				<!-- The eval bar's slot is a sibling of the board, not a child of it:
				     the bar matches the board's own rendered height (bound below), and the
				     board itself is sized from this container's height on desktop
				     (`containerFit` + [container-type:size]), so nesting the bar
				     inside the board's box would feed its own width back into that
				     calculation. -->
				<div
					class="flex items-start justify-center gap-2 lg:flex-1 lg:min-h-0 lg:[container-type:size]"
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
						interactable={explore.active || (drill.phase === 'playing' && !drill.locked && !isReviewing)}
						onmove={handleBoardMove}
						prefs={data.boardPrefs}
						hintSquare={explore.active ? null : hintSquare}
						arrowMove={explore.active ? null : arrowMove}
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
							stopLabel={m.explore_controls_back_to_line()}
							{boardWidth}
						/>
					{:else}
						<MoveNavRow
							{reviewIdx}
							totalPlies={quizSteps.length}
							reviewMoves={playerMovesIn(quizSteps, reviewIdx)}
							totalMoves={playerMovesIn(quizSteps, quizSteps.length)}
							{isReviewing}
							{boardWidth}
							onstart={reviewToStart}
							onback={reviewBack}
							onforward={reviewForward}
							onlive={reviewToLive}
							onExplore={startExplore}
							exploreDisabled={!canExplore}
						/>
					{/if}

					<!-- Just the moves played so far. -->
					{#if movesSoFar}
						<div class="mt-3 p-3 bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm">
							<p class="text-sm text-(--color-muted)">{movesSoFar}</p>
						</div>
					{/if}
				</div>
			</div>

			<div
				class="w-full lg:w-80 lg:shrink-0 hidden lg:flex lg:flex-col divide-y divide-(--color-border) bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm lg:overflow-y-auto"
			>
				<!-- Progress absorbed the old standalone "Session" panel (#167): the
				     Stuck? panel is gone too — its hint offer now shares the status
				     strip above the board (see PracticeStatusStrip's hintable slot),
				     the same spot mobile always offered it in. -->
				<div class="p-4">
					<div class="flex items-baseline justify-between gap-2 mb-2">
						<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted)">{m.learn_progress_heading()}</p>
						<!-- No "Switch" button here on desktop (#93): the permanent rail
						     to the left of the board now does that job directly. -->
						<a
							href="/practice"
							class="shrink-0 text-xs font-semibold text-(--color-muted) border border-(--color-border) rounded-lg px-2 py-1 hover:bg-(--color-border)/40"
						>
							{m.learn_finish_session()}
						</a>
					</div>
					<span class="text-(--color-muted) text-sm">{m.learn_progress_count({ solved: data.solved, total: data.total })}</span>
					<div class="h-1.5 rounded-full bg-(--color-border) overflow-hidden mt-2">
						<div
							class="h-full bg-(--color-accent) rounded-full"
							style={`width: ${data.total ? (data.solved / data.total) * 100 : 0}%`}
						></div>
					</div>
					<span class="text-(--color-muted) text-sm mt-3 block">{m.learn_session_count({ count: learnedThisSession })}</span>
					<div class="h-1.5 rounded-full bg-(--color-border) overflow-hidden mt-2">
						<div class="h-full bg-teal-500 dark:bg-teal-400 rounded-full" style={`width: ${sessionRatio * 100}%`}></div>
					</div>
				</div>

				<div class="p-4">
					<p class="text-xs font-semibold uppercase tracking-wide text-(--color-muted) mb-2">{m.learn_this_line_heading()}</p>
					<MoveList rows={moveRows} />
					{#if drill.attemptMistakeCount > 0}
						<p class="text-xs font-medium text-[#F28B82] mt-1">
							{m.learn_mistake_count({ count: drill.attemptMistakeCount })}
						</p>
					{/if}
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
							stopLabel={m.explore_controls_back_to_line()}
						/>
					{:else}
						<MoveNavRow
							{reviewIdx}
							totalPlies={quizSteps.length}
							reviewMoves={playerMovesIn(quizSteps, reviewIdx)}
							totalMoves={playerMovesIn(quizSteps, quizSteps.length)}
							{isReviewing}
							onstart={reviewToStart}
							onback={reviewBack}
							onforward={reviewForward}
							onlive={reviewToLive}
							onExplore={startExplore}
							exploreDisabled={!canExplore}
						/>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	{#if pickerOpen && repertoireId}
		<VariationPicker
			{repertoireId}
			onselect={selectVariation}
			onselectchapter={selectChapterRepresentative}
			onclose={() => (pickerOpen = false)}
		/>
	{/if}
</main>
