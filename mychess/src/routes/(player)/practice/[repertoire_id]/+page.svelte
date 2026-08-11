<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import LevelList from '$lib/components/LevelList.svelte';
	import type { Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { goto, invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { levelTag } from '$lib/mastery/tags';
	import type { PracticeView, QuizStep } from '$lib/mastery/practice';
	import { reviewFreshness, pickMaintenanceLevels } from '$lib/mastery/levelProgress';

	let { data } = $props<{ data: any }>();

	let quizIdx = $state(0);
	let boardFen = $state('');
	// 'advancing' is the brief, non-interactive gap between the final correct
	// move of an attempt (shown as a gold star, not a click-through card) and
	// the next task loading — auto-advances on its own. 'leveled-up' and
	// 'leveled-down' are the only phases that still wait for a Continue click,
	// since those are rarer milestones worth pausing on.
	let phase = $state<'playing' | 'advancing' | 'leveled-up' | 'leveled-down'>('playing');
	let locked = $state(false);
	let replaying = $state(false);
	// Consecutive wrong attempts on the CURRENT quiz move — resets the moment
	// it's solved or a new attempt starts. After 3, a hint becomes available;
	// requesting it highlights the correct piece's square, never the move.
	let wrongCount = $state(0);
	let hintRequested = $state(false);
	// Whether THIS ATTEMPT (not just this move) has had any mistake yet —
	// reset only in resetForAttempt(), reported once when the attempt
	// finishes (see reportAttempt). Previous-level-band mistakes are NOT
	// tracked here — those are reported the instant they happen (see
	// reportPreviousLevelMistake), not batched until the attempt completes,
	// so demotion can fire even if the player never gets this move right.
	let attemptHadMistake = $state(false);
	let advanceTimeout: ReturnType<typeof setTimeout> | undefined;
	// How long the leveled-up/leveled-down banner stays up before auto-
	// advancing into the next attempt — long enough to actually read the
	// message, unlike the brief per-move hold above.
	const LEVEL_TRANSITION_HOLD_MS = 1800;
	let levelTransitionTimeout: ReturnType<typeof setTimeout> | undefined;
	// Bumped on every resetForAttempt() call so an in-flight prefix replay
	// (or a mid-flight branch continuation fetch) notices it's been
	// superseded (e.g. rapid re-navigation) and stops writing to state
	// instead of racing a newer reset.
	let resetToken = 0;
	// The attempt-report POST is fire-and-forget from handleMove's final move
	// (so the board never blocks on the network) — but nextAttempt must await
	// it before merging its result, or a stale merge could race the write and
	// re-serve the same task, making Continue look like it did nothing.
	let pendingReport: Promise<PracticeView | null> | null = null;
	// The in-progress attempt's remaining quiz steps — seeded from
	// attempt.quizSteps on every resetForAttempt(), but extended in place
	// when a mid-line 'continue' branch is taken (see handleMove) rather than
	// staying a pure derived read of `attempt`, since a continuation only
	// exists client-side until the attempt is completed or abandoned.
	let liveQuizSteps = $state<QuizStep[]>([]);
	// Which task to credit if the attempt is completed — starts as the
	// pinned attempt's own taskKey, reassigned to the continued line's
	// taskKey each time a 'continue' branch is taken, so completing a
	// (possibly repeatedly) continued line credits the LAST line actually
	// walked, not the one the attempt originally pinned.
	let creditTaskKey = $state<string | null>(null);
	// The attempt's ORIGINAL pin, fixed for the whole attempt (unlike
	// creditTaskKey, never reassigned on a branch) — sent alongside the
	// credited task so the server can requeue it if a branch left it
	// abandoned. Without this, a branch taken on the very first move (e.g.
	// an obvious alternative reply) never gives this task ANY outcome, so it
	// stays stuck as the queue's FIFO head, re-served every attempt.
	let pinnedTaskKey = $state<string | null>(null);

	// Practice depth: how many levels deep the level system currently goes
	// into this repertoire (see `effectiveLevelCap`). Configurable, not fixed
	// at import — the full repertoire is always stored, so raising this later
	// reveals content that was there all along instead of needing a re-upload.
	let editingDepth = $state(false);
	let depthInput = $state(6);
	let depthSaving = $state(false);
	let depthError = $state('');

	async function saveDepth() {
		if (!Number.isInteger(depthInput) || depthInput < 1) {
			depthError = 'Enter a whole number of 1 or more';
			return;
		}
		depthSaving = true;
		depthError = '';
		try {
			const res = await fetch(`/api/repertoires/${repertoireId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ practiceDepthLevels: depthInput })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? 'Failed to update practice depth');
			}
			editingDepth = false;
			await invalidateAll();
		} catch (err) {
			depthError = err instanceof Error ? err.message : 'Failed to update practice depth';
		} finally {
			depthSaving = false;
		}
	}

	// Maintenance review: once a repertoire is mastered, memory still fades —
	// "Refresh now" on the Mastered screen starts a shuffled multi-level
	// session through the SAME read-only review path a manual "review this
	// past level" click already uses (reviewLevel !== null never reports to
	// level_progress — see handleMove/nextAttempt). `maintenanceQueue` is the
	// remaining levels to visit; non-null exactly while a session is active,
	// which is what lets nextAttempt() tell an ordinary single-level review
	// (cycle the same level indefinitely) apart from a maintenance session
	// (advance through several distinct levels, then finish).
	const MAINTENANCE_SESSION_SIZE = 6;
	let maintenanceQueue = $state<number[] | null>(null);
	let maintenanceTotal = $state(0);

	function startMaintenanceSession() {
		const levels = pickMaintenanceLevels(data.totalLevels, MAINTENANCE_SESSION_SIZE);
		if (levels.length === 0) return;
		maintenanceQueue = levels;
		maintenanceTotal = levels.length;
		goto(`/practice/${repertoireId}?level=${levels[0]}`);
	}

	async function finishMaintenanceSession() {
		maintenanceQueue = null;
		try {
			await fetch('/api/practice/maintenance-review', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId })
			});
		} catch {
			// Best-effort — worst case the freshness badge doesn't update until
			// the next successful session; nothing in the review itself is lost.
		}
		await goto(`/practice/${repertoireId}`);
	}

	const freshness = $derived(reviewFreshness(data.lastReviewedAt ?? null, new Date()));
	const freshnessDisplay = $derived(
		data.lastReviewedAt === null
			? { label: '🔴 Never reviewed since mastering', color: 'text-red-600' }
			: {
					fresh: { label: '🟢 Fresh — reviewed recently', color: 'text-green-600' },
					'due-soon': { label: '🟡 Getting stale', color: 'text-amber-600' },
					overdue: { label: '🔴 Overdue for a refresh', color: 'text-red-600' }
				}[freshness]
	);

	const REPLAY_STEP_MS = 550;
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	const attempt = $derived(data.attempt);
	const repertoireId = $derived(data.repertoire?.id);
	const reviewLevel = $derived(data.reviewLevel as number | null);
	const currentTag = $derived(
		typeof data.level === 'number' ? levelTag(data.level, data.totalLevels) : levelTag(data.totalLevels, data.totalLevels)
	);

	function selectLevel(level: number) {
		goto(`/practice/${repertoireId}?level=${level}`);
	}

	function exitReview() {
		maintenanceQueue = null;
		goto(`/practice/${repertoireId}`);
	}

	// The correct move's origin square — computed from the step's own
	// fromFen/san rather than stored, since only the destination is ever
	// meant to stay hidden.
	const hintSquare = $derived.by(() => {
		if (!hintRequested) return null;
		const step = liveQuizSteps[quizIdx];
		if (!step) return null;
		try {
			return new Chess(step.fromFen).move(step.san)?.from ?? null;
		} catch {
			return null;
		}
	});

	function advanceThroughOpponentReplies() {
		while (liveQuizSteps[quizIdx] && !liveQuizSteps[quizIdx].isPlayerTurn) {
			boardFen = liveQuizSteps[quizIdx].toFen;
			quizIdx++;
		}
	}

	// From Level 2 onward, `attempt.prefix` holds the already-mastered moves
	// leading up to this attempt's quiz. Playing them out one at a time (like
	// a PC opponent replaying the line) instead of jumping straight to the
	// quiz position mirrors how the line is actually reached in a real game,
	// reinforcing the path there rather than just the isolated position.
	async function resetForAttempt() {
		const myToken = ++resetToken;
		clearTimeout(advanceTimeout);
		clearTimeout(levelTransitionTimeout);
		quizIdx = 0;
		phase = 'playing';
		locked = false;
		replaying = false;
		wrongCount = 0;
		hintRequested = false;
		attemptHadMistake = false;
		liveQuizSteps = attempt?.quizSteps ?? [];
		creditTaskKey = attempt?.taskKey ?? null;
		pinnedTaskKey = attempt?.taskKey ?? null;
		if (!attempt) return;

		if (attempt.prefix.length === 0) {
			boardFen = attempt.quizSteps[0]?.fromFen ?? '';
			advanceThroughOpponentReplies();
			return;
		}

		replaying = true;
		boardFen = attempt.prefix[0].fromFen;
		for (const step of attempt.prefix) {
			await sleep(REPLAY_STEP_MS);
			if (myToken !== resetToken) return; // superseded by a newer reset
			boardFen = step.toFen;
		}
		if (myToken !== resetToken) return;
		replaying = false;
		advanceThroughOpponentReplies();
	}

	// Set the board's initial position synchronously, before ChessBoard's own
	// onMount runs — it throws on an empty FEN, and a child's onMount fires
	// before this component's own $effect does, so waiting for the effect
	// below to set boardFen for the first time is too late.
	resetForAttempt();

	// Reset when the REPERTOIRE changes (including on mount) OR when
	// `reviewLevel` changes (selecting a different level to review, or
	// exiting review) — not on every `attempt` change, since nextAttempt()
	// below also changes `attempt` via invalidateAll() and needs to decide
	// for itself whether to jump straight into the next attempt or show a
	// level transition notice. `reviewLevel` matters here specifically
	// because `selectLevel`/`exitReview` navigate within this SAME route
	// (only the `?level=` query param changes), which SvelteKit handles by
	// reusing this component instance and just updating `data` — it does
	// NOT remount, so without this, `resetToken` would never bump on a
	// level switch, leaving `resetToken`-gated async work (e.g. a
	// still-in-flight branch continuation fetch below) unable to tell it's
	// been superseded and free to splice stale content into a since-moved-on
	// view, including reporting progress against the wrong level.
	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- deliberate Svelte dependency-tracking read, not a no-op statement
		repertoireId;
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- deliberate Svelte dependency-tracking read, not a no-op statement
		reviewLevel;
		untrack(() => resetForAttempt());
	});

	async function fetchContinuation(
		activeLevel: number,
		variationKey: string,
		afterPlayerMoveIndex: number
	): Promise<{ quizSteps: QuizStep[]; taskKey: string } | null> {
		try {
			const res = await fetch('/api/practice/continue', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repertoireId,
					level: activeLevel,
					variationKey,
					afterPlayerMoveIndex
				})
			});
			if (!res.ok) return null;
			return await res.json();
		} catch {
			return null;
		}
	}

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (phase !== 'playing' || locked || replaying) return false;
		const myToken = resetToken;
		const currentReviewLevel = reviewLevel;
		// Captured now, not read live inside fetchContinuation after the
		// 'continue' branch's await below — reviewLevel changing mid-hold now
		// bumps resetToken (see the $effect above) and supersedes this whole
		// attempt, but the level VALUE itself must still come from this same
		// snapshot, not a live read, so a `'continue'` request that does slip
		// through the window before the token check can't ask the server to
		// resume a line at the wrong level.
		const currentLevel = currentReviewLevel ?? (data.level as number);
		const step = liveQuizSteps[quizIdx];
		if (!step) return false;

		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			logMove(step.moveId, detail.san, true, currentLevel);
			// Whether THIS move is the last one in the attempt — decided now,
			// synchronously, since ChessBoard needs the star-vs-check choice at
			// move time, before the 500ms hold below even starts.
			const isFinalMove = quizIdx + 1 >= liveQuizSteps.length;
			// Fire the completion report NOW, before the hold below, not after
			// it — the report's own network round trip then overlaps with the
			// 500ms hold instead of stacking after it. nextAttempt() still
			// awaits pendingReport before reloading, so correctness (never
			// reloading before the write lands) is unchanged. Reports
			// creditTaskKey, not this attempt's originally-pinned key — if a
			// branch was continued earlier in this same attempt, that's the
			// line actually being finished right now (reportAttempt separately
			// tells the server about the abandoned pin, if any). Skipped during review,
			// which is a pure read-only replay. Uses the REVIEW-LEVEL CAPTURED
			// AT THE TOP of this function, not the live reactive value — the
			// player can navigate to a different level or exit review during
			// the hold, which changes `reviewLevel` without going through
			// resetForAttempt(), and reporting against a live (wrong) value
			// would corrupt an unrelated task's progress.
			if (isFinalMove && currentReviewLevel === null && creditTaskKey) {
				pendingReport = reportAttempt(creditTaskKey);
			}
			// Hold the board here so the check/star is actually visible before
			// advancing — updating boardFen in the same tick would clear it
			// before the browser ever paints it.
			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				quizIdx++;
				advanceThroughOpponentReplies();
				locked = false;
				if (quizIdx >= liveQuizSteps.length) {
					// No confirmation click for a plain solve — auto-advance
					// straight to the next task. `nextAttempt()` still pauses on
					// a leveled-up/leveled-down banner itself when relevant.
					phase = 'advancing';
					nextAttempt();
				}
			}, 500);
			return isFinalMove ? 'final' : true;
		}

		// Not the pinned answer — but the repertoire may allow more than one
		// reply at this exact position (see splitAttempt/alternativesAt).
		// Accept it rather than forcing the player to guess which of their own
		// memorized options this particular attempt happened to pin.
		const alt = step.alternatives.find((a: QuizStep['alternatives'][number]) => a.san === detail.san);
		if (alt) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			logMove(step.moveId, detail.san, true, currentLevel);

			if (alt.kind === 'completes') {
				// Lands on another task's own target-depth move — finishes it
				// immediately, same as solving the pinned line's own final move.
				if (currentReviewLevel === null) pendingReport = reportAttempt(alt.taskKey);
				advanceTimeout = setTimeout(() => {
					locked = false;
					phase = 'advancing';
					nextAttempt();
				}, 500);
				return 'final';
			}

			if (alt.kind === 'dead-end') {
				// A shorter sibling already fully resolved at an earlier level —
				// nothing left to continue, nothing to credit. Accept, end
				// cleanly, leave the originally-pinned task untouched for
				// another attempt.
				advanceTimeout = setTimeout(() => {
					locked = false;
					phase = 'advancing';
					nextAttempt();
				}, 500);
				return true;
			}

			// alt.kind === 'continue' — this line has more content ahead.
			// Resume it in place instead of ending the attempt: fetch the rest
			// of that specific line and splice it into the live quiz sequence,
			// so play continues seamlessly rather than dropping the player
			// into an unrelated fresh attempt.
			const afterPlayerMoveIndex = step.playerMoveIndex;
			const branchIdx = quizIdx;
			advanceTimeout = setTimeout(async () => {
				const continuation = await fetchContinuation(currentLevel, alt.variationKey, afterPlayerMoveIndex);
				if (myToken !== resetToken) return; // superseded while we were awaiting — don't touch boardFen
				// either; a superseding resetForAttempt() has already set it correctly for whatever attempt is
				// now active (or intentionally left it alone if there's no attempt to show a board for at all).
				boardFen = alt.toFen;
				locked = false;
				if (!continuation) {
					// Fetch failed — fall back to the dead-end behavior above
					// rather than leaving the player stuck mid-attempt.
					phase = 'advancing';
					nextAttempt();
					return;
				}
				liveQuizSteps = [...liveQuizSteps.slice(0, branchIdx + 1), ...continuation.quizSteps];
				creditTaskKey = continuation.taskKey;
				quizIdx = branchIdx + 1;
				advanceThroughOpponentReplies();
				if (quizIdx >= liveQuizSteps.length) {
					// The continuation completed immediately (nothing left after
					// auto-playing the opponent's reply) — same as any other
					// end-of-attempt completion.
					phase = 'advancing';
					if (currentReviewLevel === null) pendingReport = reportAttempt(creditTaskKey);
					nextAttempt();
				}
				// Otherwise phase stays 'playing' — no restart, just resume.
			}, 500);
			return true;
		}

		playWrong();
		wrongCount++;
		logMove(step.moveId, detail.san, false, currentLevel);
		if (currentReviewLevel === null) {
			attemptHadMistake = true;
			if (step.band === 'previous') reportPreviousLevelMistake();
		}
		// Don't reveal the book move — just mark the square wrong and let
		// the player try again on the same position.
		return false;
	}

	// Returns the fresh `PracticeView` the server built from this report, or
	// `null` on a failed/errored request — `nextAttempt` falls back to
	// `invalidateAll()` in that case rather than merging nothing. Reads
	// `pinnedTaskKey` synchronously (before the fetch's await) so a later
	// resetForAttempt() reassigning it for the NEXT attempt can't affect an
	// already-in-flight report for this one.
	async function reportAttempt(taskKey: string): Promise<PracticeView | null> {
		const abandonedTaskKey = pinnedTaskKey && pinnedTaskKey !== taskKey ? pinnedTaskKey : undefined;
		try {
			const res = await fetch('/api/practice/attempt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repertoireId,
					taskKey,
					hadMistake: attemptHadMistake,
					abandonedTaskKey
				})
			});
			if (!res.ok) return null;
			return await res.json();
		} catch {
			// Report failed — the attempt itself already played out on the
			// board; just skip silently rather than blocking the player on a
			// network hiccup. Worst case: the same task is served again.
			return null;
		}
	}

	// Fires the instant a wrong move lands on review material — not batched
	// until the attempt completes, since a player who keeps failing this
	// exact move and never gets it right would otherwise never accumulate
	// enough mistakes to demote, no matter how many times they fail it. If
	// this was the demoting mistake, abandon the in-flight attempt right
	// away rather than let the player keep playing against a now-stale quiz.
	async function reportPreviousLevelMistake() {
		// Captured before the network await — that's the race window now,
		// since there's no longer a separate invalidateAll() afterward.
		const myToken = resetToken;
		try {
			const res = await fetch('/api/practice/mistake', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId })
			});
			const result = await res.json();
			if (result?.demoted) await handleMidAttemptDemotion(result.view, myToken);
		} catch {
			// Report failed — worst case this one mistake isn't counted; the
			// player just needs one more before demotion fires.
		}
	}

	// Fire-and-forget log of a single move resolution — every correct and
	// wrong move, including during review (unlike reportAttempt/
	// reportPreviousLevelMistake, which are skipped in review since neither
	// touches level_progress there — this log isn't gated the same way,
	// since it doesn't affect progress and a fuller activity picture is the
	// whole point). A dropped log row has no effect on the board or on
	// progress, so this never blocks or retries.
	function logMove(moveId: string, playedSan: string, isCorrect: boolean, level: number) {
		fetch('/api/practice/move-log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ repertoireId, moveId, playedSan, isCorrect, level })
		}).catch(() => {});
	}

	// A demotion detected mid-attempt (not at the natural end-of-attempt
	// point `nextAttempt` handles) — the in-flight quiz was built for the
	// level just left, so abandon it and show the same banner a
	// completion-triggered demotion would. `view` is the fresh PracticeView
	// the mistake endpoint already built server-side for the demoted level —
	// merged directly rather than re-fetched via invalidateAll().
	async function handleMidAttemptDemotion(view: PracticeView, myToken: number) {
		if (myToken !== resetToken) return; // superseded by a resetForAttempt() while the mistake POST was in flight
		// Bump the token NOW, not just whenever the eventual resetForAttempt()
		// fires — this attempt is abandoned as of this instant. Without this,
		// a completion report already in flight for this same attempt (the
		// player kept playing after the demoting mistake, since a wrong review
		// move doesn't lock the board, and then solved the rest correctly)
		// lands after this demotion applies, and nextAttempt()'s own
		// `myToken !== resetToken` check — captured before this ever ran —
		// wouldn't see anything stale yet and would go on to merge that
		// completion's (now-moot) view on top of this one, undoing the
		// leveled-down banner and looking like an unexplained restart.
		resetToken++;
		clearTimeout(advanceTimeout);
		locked = true;
		phase = 'advancing';
		data = { ...data, ...view };
		phase = 'leveled-down';
		scheduleLevelTransition();
	}

	function levelRank(level: number | 'mastered'): number {
		return level === 'mastered' ? Infinity : level;
	}

	// Holds the leveled-up/leveled-down banner up long enough to read, then
	// auto-advances into the next attempt — no confirmation click needed.
	function scheduleLevelTransition() {
		const myToken = resetToken;
		clearTimeout(levelTransitionTimeout);
		levelTransitionTimeout = setTimeout(() => {
			if (myToken !== resetToken) return; // superseded by a resetForAttempt() while we were waiting
			resetForAttempt();
		}, LEVEL_TRANSITION_HOLD_MS);
	}

	async function nextAttempt() {
		const levelBefore = data.level;
		const myToken = resetToken;
		const view = pendingReport ? await pendingReport : null;
		pendingReport = null;
		if (myToken !== resetToken) return; // superseded by a resetForAttempt() while we were awaiting

		// A maintenance session cycles through several DISTINCT levels once
		// each, then finishes — unlike an ordinary single-level review (below),
		// which re-fetches another random task at the SAME level indefinitely
		// until the player manually exits. No report is ever pending here
		// (review is always read-only), so there's nothing to merge — just
		// advance the queue or wrap up.
		if (maintenanceQueue) {
			const remaining = maintenanceQueue.slice(1);
			if (remaining.length > 0) {
				maintenanceQueue = remaining;
				await goto(`/practice/${repertoireId}?level=${remaining[0]}`);
			} else {
				await finishMaintenanceSession();
			}
			return;
		}

		if (view) {
			// The report already carries the fresh state — merge it in
			// directly instead of re-fetching the same repertoire content via
			// invalidateAll().
			data = { ...data, ...view };
		} else {
			// Nothing to merge: either a dead-end branch alternative (no
			// report was ever sent) or the report failed — fall back to the
			// source of truth.
			await invalidateAll();
			if (myToken !== resetToken) return;
		}
		// If completing that attempt changed the active level — up on
		// mastering it, or down on a demotion — surface that instead of
		// silently dropping the player into the next quiz. Never applies
		// during review: reviewing a passed level can't change which level is
		// active.
		if (reviewLevel === null && levelRank(data.level) > levelRank(levelBefore)) {
			phase = 'leveled-up';
			scheduleLevelTransition();
		} else if (reviewLevel === null && levelRank(data.level) < levelRank(levelBefore)) {
			phase = 'leveled-down';
			scheduleLevelTransition();
		} else {
			resetForAttempt();
		}
	}
</script>

<svelte:head>
	<title>Practice {data.repertoire?.name ?? 'Repertoire'} — MyChess</title>
</svelte:head>

{#snippet practiceDepthControl()}
	<div class="p-3 bg-white border border-gray-200 rounded-2xl shadow-sm text-center text-sm">
		{#if editingDepth}
			<div class="flex items-center justify-center gap-2">
				<label for="depth-input" class="text-gray-500">Practice depth:</label>
				<input
					id="depth-input"
					type="number"
					min="1"
					step="1"
					bind:value={depthInput}
					disabled={depthSaving}
					class="w-16 rounded-lg border border-gray-300 px-2 py-1 text-center disabled:opacity-60"
				/>
				<span class="text-gray-500">levels</span>
				<button onclick={saveDepth} disabled={depthSaving} class="text-indigo-600 font-medium hover:underline disabled:opacity-60">
					Save
				</button>
				<button onclick={() => (editingDepth = false)} disabled={depthSaving} class="text-gray-400 hover:underline disabled:opacity-60">
					Cancel
				</button>
			</div>
			{#if depthError}<p class="text-red-600 text-xs mt-1">{depthError}</p>{/if}
		{:else}
			<button
				onclick={() => {
					depthInput = data.repertoire?.practiceDepthLevels ?? 6;
					editingDepth = true;
				}}
				class="text-gray-500 hover:text-indigo-600"
			>
				Practice depth: <span class="font-medium">{data.repertoire?.practiceDepthLevels} levels</span>
				· <span class="text-indigo-600 underline">edit</span>
			</button>
		{/if}
	</div>
{/snippet}

<main class="min-h-screen bg-gray-50 p-4 max-w-5xl mx-auto pb-24">
	<div class="mb-4">
		<a href="/practice" class="text-gray-400 text-sm hover:text-gray-600">← All Repertoires</a>
	</div>

	{#if reviewLevel !== null}
		<div class="mb-4 flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 text-sm">
			{#if maintenanceQueue}
				<span class="text-indigo-700 font-medium">
					🔄 Refreshing your knowledge — {maintenanceTotal - maintenanceQueue.length + 1} of {maintenanceTotal}
				</span>
			{:else}
				<span class="text-indigo-700 font-medium">🔁 Reviewing Level {reviewLevel}</span>
			{/if}
			<button onclick={exitReview} class="text-indigo-600 hover:underline">Exit review</button>
		</div>
	{/if}

	{#if data.level === 'mastered' && data.totalVariations > 0 && reviewLevel === null}
		<div class="flex flex-col items-center gap-6 text-center py-16">
			<p class="text-7xl">🏆</p>
			<h1 class="text-3xl font-bold text-gray-900">Repertoire Mastered!</h1>
			<p class="text-gray-500">Every variation in {data.repertoire?.name} is fully learned.</p>
			<a
				href="/practice"
				class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition"
			>
				Back to Repertoires
			</a>
			<div class="w-full max-w-sm text-left space-y-4">
				<div class="p-4 bg-white border border-gray-200 rounded-2xl shadow-sm text-center space-y-2">
					<p class="text-sm font-medium {freshnessDisplay.color}">{freshnessDisplay.label}</p>
					<p class="text-xs text-gray-400">Mastering a repertoire isn't the finish line — memory fades over time.</p>
					<button
						onclick={startMaintenanceSession}
						class="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
					>
						Refresh now
					</button>
				</div>
				{@render practiceDepthControl()}
				<LevelList totalLevels={data.totalLevels} currentLevel={data.level} reviewLevel={null} onselect={selectLevel} />
			</div>
		</div>
	{:else if !attempt}
		<div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
			<p class="text-5xl">📭</p>
			<h1 class="text-2xl font-bold text-gray-700">Nothing to practice</h1>
			<p class="text-gray-400">This repertoire has no moves for your color yet.</p>
			<a href="/practice" class="text-indigo-600 hover:underline">Back to Repertoires</a>
		</div>
	{:else}
		<div class="flex flex-col lg:flex-row lg:items-start gap-6">
			<div class="flex-1">
				<p class="text-center text-gray-700 font-semibold mb-4 lg:hidden">
					{replaying ? 'Watch how we got here…' : phase === 'playing' ? 'What is the best move?' : ''}
					{#if wrongCount >= 3 && !hintRequested && phase === 'playing' && !replaying}
						<button
							onclick={() => (hintRequested = true)}
							class="ml-2 inline-flex items-center gap-1 text-sm font-medium text-amber-600 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					{/if}
				</p>

				<ChessBoard
					fen={boardFen}
					orientation={data.repertoire?.color === 'black' ? 'black' : 'white'}
					interactable={phase === 'playing' && !locked && !replaying}
					onmove={handleMove}
					prefs={data.boardPrefs}
					{hintSquare}
				/>
			</div>

			<div class="w-full lg:w-72 shrink-0 space-y-4">
				<div class="p-4 bg-white border border-gray-200 rounded-2xl shadow-sm text-center">
					<p class="text-gray-400 text-sm font-medium">
						{data.repertoire?.name} · {typeof data.level === 'number' ? `Level ${data.level} of ${data.totalLevels}` : 'Mastered'} · {currentTag}
					</p>
					<p class="text-gray-400 text-sm">{data.levelSolvedCount}/{data.levelTaskCount} solved</p>
				</div>

				{@render practiceDepthControl()}

				<LevelList
					totalLevels={data.totalLevels}
					currentLevel={data.level}
					reviewLevel={reviewLevel}
					onselect={selectLevel}
				/>

				<p class="text-center text-gray-700 font-semibold hidden lg:block">
					{replaying ? 'Watch how we got here…' : phase === 'playing' ? 'What is the best move?' : ''}
				</p>
				{#if wrongCount >= 3 && !hintRequested && phase === 'playing' && !replaying}
					<p class="text-center hidden lg:block">
						<button
							onclick={() => (hintRequested = true)}
							class="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700"
						>
							<span class="text-base">💡</span> Need a hint?
						</button>
					</p>
				{/if}

				{#if phase === 'leveled-up' || phase === 'leveled-down'}
					<div class="p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
						{#if phase === 'leveled-up'}
							<p class="text-xl font-bold mb-1 text-indigo-600">🎉 Level up! Now on Level {data.level}</p>
						{:else}
							<p class="text-xl font-bold mb-1 text-amber-600">⬇️ Back to Level {data.level} — brush up and try again</p>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</main>
