<script lang="ts">
	import { onDestroy } from 'svelte';
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import MoveNavRow from '$lib/components/MoveNavRow.svelte';
	import EvalBar from '$lib/components/EvalBar.svelte';
	import type { Key } from 'chessground/types';
	import { squaresForSanMove } from '$lib/chess-moves';
	import { analyzeGame } from '$lib/engine/analyzeGame';
	import { buildAnalysis, type AnalysisEntry } from '$lib/games/build-analysis';
	import { formatEval, evalBarWhiteFraction } from '$lib/engine/uci';
	import { ExploreSession } from '$lib/mastery/explore.svelte';
	import { m } from '$lib/paraglide/messages';

	type GameMove = { ply: number; san: string; fen: string; parentFen: string };

	let { data } = $props<{ data: { game: any; boardPrefs?: any } }>();

	let abortController: AbortController | undefined;

	const game = $derived(data.game);
	const moves = $derived(game.moves as GameMove[]);
	const rootFen = $derived(
		moves[0]?.parentFen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
	);

	let reviewIdx = $state(0);
	let analysis = $state<AnalysisEntry[] | null>(game.analysis);
	let analysisStatus = $state<'pending' | 'done'>(game.analysis_status);
	let analyzing = $state(false);
	let analyzeError = $state('');
	let progress = $state({ done: 0, total: moves.length + 1 });
	let boardWidth = $state(0);
	const explore = new ExploreSession();

	const reviewFen = $derived(reviewIdx === 0 ? rootFen : moves[reviewIdx - 1].fen);
	// The explored position while off-book, the recorded game's own otherwise —
	// same pattern Practice/Learn use. EvalBar reads this too, so it answers for
	// whatever is actually on the board.
	const displayFen = $derived(explore.active ? explore.fen : reviewFen);

	function startExplore() {
		explore.start(reviewFen);
	}

	function stopExplore() {
		explore.stop();
	}

	const lastMove = $derived.by((): [Key, Key] | undefined => {
		if (reviewIdx === 0) return undefined;
		const mv = moves[reviewIdx - 1];
		const squares = squaresForSanMove(mv.parentFen, mv.san);
		return squares ? [squares.from, squares.to] : undefined;
	});

	const arrowMove = $derived.by((): { from: Key; to: Key } | null => {
		if (!analysis || reviewIdx >= moves.length) return null;
		const entry = analysis[reviewIdx];
		if (!entry?.bestMoveSan) return null;
		return squaresForSanMove(displayFen, entry.bestMoveSan);
	});

	const currentEntry = $derived(analysis && reviewIdx > 0 ? analysis[reviewIdx - 1] : null);

	type MoveCell = { move: GameMove; idx: number };
	type MovePair = { moveNumber: number; white: MoveCell; black: MoveCell | null };

	// PGN-style pairing: White's and Black's move for the same move number
	// share a row. `idx` is the move's own index in `moves` (= reviewIdx - 1
	// once reviewed), kept alongside it so each cell can jump straight there.
	const movePairs = $derived.by((): MovePair[] => {
		const pairs: MovePair[] = [];
		for (let idx = 0; idx < moves.length; idx += 2) {
			pairs.push({
				moveNumber: pairs.length + 1,
				white: { move: moves[idx], idx },
				black: idx + 1 < moves.length ? { move: moves[idx + 1], idx: idx + 1 } : null
			});
		}
		return pairs;
	});

	async function startAnalysis() {
		analyzing = true;
		analyzeError = '';
		progress = { done: 0, total: moves.length + 1 };
		abortController = new AbortController();
		const fens = [rootFen, ...moves.map((m) => m.fen)];
		try {
			const results = await analyzeGame(fens, {
				onProgress: (done, total) => {
					progress = { done, total };
				},
				signal: abortController.signal
			});
			const built = buildAnalysis(moves, results);
			const res = await fetch(`/api/games/${game.id}/analysis`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ analysis: built })
			});
			if (!res.ok) throw new Error(m.games_analyze_save_failed_error());
			analysis = built;
			analysisStatus = 'done';
		} catch (err) {
			analyzeError = err instanceof Error ? err.message : m.games_analyze_failed_error();
		} finally {
			analyzing = false;
		}
	}

	// Auto-starts once, the first time an unanalyzed game is opened; won't
	// silently retry-loop after a failure (analyzeError blocks it — the
	// Retry button below calls startAnalysis() directly).
	$effect(() => {
		if (analysisStatus === 'pending' && !analyzing && !analyzeError) startAnalysis();
	});

	onDestroy(() => {
		abortController?.abort();
	});

	// Standard chess annotation glyphs (Lichess/chess.com convention) rather
	// than words — glued directly onto a move's SAN in the move list, the way
	// "Qxd5??" is written anywhere else in chess.
	function classificationLabel(c: AnalysisEntry['classification']): string {
		if (c === 'blunder') return '??';
		if (c === 'mistake') return '?';
		if (c === 'inaccuracy') return '?!';
		return '';
	}

	function classificationClass(c: AnalysisEntry['classification']): string {
		if (c === 'blunder') return 'text-red-600 dark:text-red-400';
		if (c === 'mistake') return 'text-orange-600 dark:text-orange-400';
		if (c === 'inaccuracy') return 'text-yellow-600 dark:text-yellow-400';
		return 'text-(--color-muted)';
	}
</script>

<svelte:head>
	<title>{m.seo_game_title({ white: game.headers?.White ?? '?', black: game.headers?.Black ?? '?' })}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-5xl mx-auto px-4 py-8 grid md:grid-cols-[minmax(0,1fr)_320px] gap-6">
		<div>
			<a href="/games" class="text-(--color-muted) text-sm hover:text-(--color-text) mb-4 block"
				>{m.games_back_link()}</a
			>
			<h1 class="text-lg font-bold text-(--color-text) mb-3">
				{game.headers?.White ?? '?'} {m.games_vs()} {game.headers?.Black ?? '?'}
				<span class="text-(--color-muted) font-normal text-sm ml-2">{game.headers?.Result ?? '*'}</span>
			</h1>

			<div class="flex items-start justify-center gap-2">
				{#if explore.active}
					<EvalBar
						fen={displayFen}
						orientation={game.played_as === 'black' ? 'black' : 'white'}
						height={boardWidth}
					/>
				{/if}
				<ChessBoard
					fen={displayFen}
					interactable={explore.active}
					onmove={explore.active ? (detail) => explore.play(detail.from, detail.to) : undefined}
					orientation={game.played_as === 'black' ? 'black' : 'white'}
					lastMove={explore.active ? undefined : lastMove}
					arrowMove={explore.active ? null : arrowMove}
					prefs={data.boardPrefs}
					bind:boxWidth={boardWidth}
				/>
			</div>

			{#if explore.active}
				<div
					class="grid grid-cols-2 gap-2 mt-4 shrink-0 mx-auto w-full"
					style={boardWidth ? `max-width: ${boardWidth}px` : ''}
				>
					<button
						onclick={() => explore.undo()}
						disabled={explore.depth === 0}
						class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-sm font-semibold text-(--color-text) disabled:opacity-30"
					>
						{m.explore_controls_undo()}
					</button>
					<button
						onclick={stopExplore}
						class="py-2 rounded-xl border border-amber-300 bg-amber-50 text-sm font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
					>
						{m.games_explore_back_to_review()}
					</button>
				</div>
			{:else}
				<MoveNavRow
					{reviewIdx}
					totalPlies={moves.length}
					reviewMoves={reviewIdx}
					totalMoves={moves.length}
					isReviewing={true}
					onstart={() => (reviewIdx = 0)}
					onback={() => (reviewIdx = Math.max(reviewIdx - 1, 0))}
					onforward={() => (reviewIdx = Math.min(reviewIdx + 1, moves.length))}
					onlive={() => (reviewIdx = moves.length)}
					onExplore={analyzing ? undefined : startExplore}
				/>
			{/if}

			{#if currentEntry && !explore.active}
				<p class="mt-3 text-sm text-(--color-text)">
					{m.games_eval_label()} <span class="font-semibold tabular-nums">{formatEval(currentEntry.score)}</span>
					{#if currentEntry.classification}
						· <span class={classificationClass(currentEntry.classification)}
							>{classificationLabel(currentEntry.classification)}</span
						>
					{/if}
					{#if currentEntry.bestMoveSan}
						· {m.games_best_was_label()} <span class="font-mono">{currentEntry.bestMoveSan}</span>
					{/if}
				</p>
			{/if}

			{#if analyzing}
				<div class="mt-4 space-y-2">
					<div class="flex justify-between text-sm text-(--color-muted)">
						<span>{m.games_analyzing_label()}</span>
						<span>{m.games_progress_count({ done: progress.done, total: progress.total })}</span>
					</div>
					<div class="w-full bg-(--color-border) rounded-full h-2 overflow-hidden">
						<div
							class="bg-(--color-accent) h-2 transition-all duration-300"
							style="width: {(progress.done / Math.max(progress.total, 1)) * 100}%"
						></div>
					</div>
				</div>
			{/if}

			{#if analyzeError}
				<div class="mt-4 flex items-center gap-3">
					<p class="text-red-600 dark:text-red-400 text-sm">{analyzeError}</p>
					<button onclick={startAnalysis} class="text-sm font-semibold text-(--color-accent) hover:underline"
						>{m.games_retry_button()}</button
					>
				</div>
			{/if}

			{#if analysis}
				<div class="mt-4 flex items-end gap-px h-12" aria-hidden="true">
					{#each analysis as entry, i (entry.ply)}
						<button
							onclick={() => (reviewIdx = i + 1)}
							class="flex-1 bg-(--color-border) hover:opacity-80 transition-opacity"
							style="height: {evalBarWhiteFraction(entry.score) * 100}%"
							aria-label={m.games_jump_to_move({ move: i + 1 })}
						></button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="border border-(--color-border) rounded-xl bg-(--color-surface) p-3 max-h-[70vh] overflow-y-auto">
			<h2 class="text-sm font-semibold text-(--color-muted) uppercase tracking-wide mb-2">{m.games_moves_heading()}</h2>
			<ol class="text-sm space-y-1">
				{#each movePairs as pair (pair.moveNumber)}
					{@const whiteEntry = analysis?.[pair.white.idx]}
					{@const blackEntry = pair.black ? analysis?.[pair.black.idx] : undefined}
					<li class="grid grid-cols-[2rem_1fr_1fr] gap-1 items-center">
						<span class="text-(--color-muted) text-xs text-right pr-1">{pair.moveNumber}.</span>
						<button
							onclick={() => (reviewIdx = pair.white.idx + 1)}
							class="text-left px-2 py-1 rounded-lg {reviewIdx === pair.white.idx + 1
								? 'bg-(--color-accent)/10 font-semibold'
								: 'hover:bg-(--color-border)/40'}"
						>
							{pair.white.move.san}{#if whiteEntry?.classification}<span
									class={classificationClass(whiteEntry.classification)}
									>{classificationLabel(whiteEntry.classification)}</span
								>{/if}
						</button>
						{#if pair.black}
							<button
								onclick={() => (reviewIdx = pair.black!.idx + 1)}
								class="text-left px-2 py-1 rounded-lg {reviewIdx === pair.black.idx + 1
									? 'bg-(--color-accent)/10 font-semibold'
									: 'hover:bg-(--color-border)/40'}"
							>
								{pair.black.move.san}{#if blackEntry?.classification}<span
										class={classificationClass(blackEntry.classification)}
										>{classificationLabel(blackEntry.classification)}</span
									>{/if}
							</button>
						{/if}
					</li>
				{/each}
			</ol>
		</div>
	</div>
</main>
