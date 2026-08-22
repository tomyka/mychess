<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import type { Key } from 'chessground/types';
	import { playCorrect, playWrong } from '$lib/sounds';
	import type { VariationStep } from '$lib/mastery/variations';
	import { playOpponentReplies } from '$lib/mastery/playback';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props<{ data: any }>();

	/**
	 * Chapter mastery runs (#100). One chapter, every learned variation in it,
	 * back to back, no arrows and — decided explicitly with the product owner —
	 * no hints at all. A single mistake ends the run.
	 *
	 * A failed run does NOT demote anything: failing an exam shouldn't unlearn the
	 * material, and Practice is where forgetting is detected. Also decided
	 * explicitly rather than inferred.
	 *
	 * Run state is intentionally client-only. A refresh ends the run, which is
	 * consistent with "one continuous sitting" and avoids a half-finished exam
	 * being resumable hours later.
	 */
	type Phase = 'chapters' | 'running' | 'failed' | 'passed';

	let phase = $state<Phase>('chapters');
	let chapter = $state<string | null>(null);
	let queue = $state<{ variationKey: string; path: VariationStep[] }[]>([]);
	let queueIdx = $state(0);
	let plyIdx = $state(0);
	let boardFen = $state('');
	let locked = $state(false);
	let saveError = $state<string | null>(null);
	// Chapters mastered during this visit, so the list reflects a completed run
	// without a full reload.
	let masteredNow = $state<string[]>([]);

	const chapters = $derived(
		(data.chapters ?? []).map((c: any) => ({ ...c, mastered: c.mastered || masteredNow.includes(c.chapter) }))
	);
	const allMastered = $derived(chapters.length > 0 && chapters.every((c: any) => c.mastered));
	const steps = $derived(queue[queueIdx]?.path ?? []);
	const progressLabel = $derived(`${Math.min(queueIdx + 1, queue.length)} / ${queue.length}`);

	function advanceThroughOpponentReplies() {
		const played = playOpponentReplies(steps, plyIdx, boardFen);
		plyIdx = played.plyIdx;
		boardFen = played.fen;
	}

	function startVariation() {
		plyIdx = 0;
		locked = false;
		boardFen = steps[0]?.fromFen ?? '';
		advanceThroughOpponentReplies();
	}

	function startRun(name: string) {
		chapter = name;
		queue = (data.queues?.[name] ?? []) as { variationKey: string; path: VariationStep[] }[];
		if (queue.length === 0) return;
		queueIdx = 0;
		saveError = null;
		phase = 'running';
		startVariation();
	}

	function abandon() {
		phase = 'chapters';
		chapter = null;
		queue = [];
	}

	async function finishRun() {
		phase = 'passed';
		try {
			const res = await fetch('/api/practice/mastery-run', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId: data.repertoire?.id, chapterName: chapter })
			});
			if (!res.ok) throw new Error(String(res.status));
			if (chapter) masteredNow = [...masteredNow, chapter];
		} catch {
			// The run really was completed, so the celebration stands — but say
			// plainly that it wasn't recorded rather than showing mastery that the
			// next page load will contradict.
			saveError = m.practice_mastery_save_error();
		}
	}

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (phase !== 'running' || locked) return false;
		const step = steps[plyIdx];
		if (!step) return false;

		if (detail.san !== step.san) {
			playWrong();
			// One mistake ends the run. No retry of the move, no partial credit —
			// that is what makes mastery mean something.
			phase = 'failed';
			locked = true;
			return false;
		}

		playCorrect();
		locked = true;
		setTimeout(() => {
			boardFen = step.toFen;
			plyIdx++;
			advanceThroughOpponentReplies();
			locked = false;
			if (plyIdx >= steps.length) {
				if (queueIdx + 1 >= queue.length) {
					finishRun();
				} else {
					queueIdx++;
					startVariation();
				}
			}
		}, 320);
		return true;
	}
</script>

<svelte:head>
	<!-- Fallback name reused verbatim from Learn's per-repertoire page. -->
	<title>{m.seo_practice_mastery_title({ name: data.repertoire?.name ?? m.learn_repertoire_fallback_name() })}</title>
</svelte:head>

<main class="min-h-screen lg:min-h-0 lg:h-[calc(100vh-4rem)] bg-(--color-bg) p-4 max-w-7xl mx-auto pb-24 lg:pb-4 flex flex-col">
	<div class="mb-4 flex items-center gap-3 shrink-0 flex-wrap">
		<a href="/practice/{data.repertoire?.id}" class="text-(--color-muted) text-sm hover:text-(--color-text)">
			{m.practice_mastery_back_link()}
		</a>
		<h1 class="text-base font-bold text-(--color-text) flex-1 min-w-0 truncate">
			{m.practice_mastery_page_heading({ name: data.repertoire?.name })}
		</h1>
	</div>

	{#if phase === 'chapters'}
		<div class="max-w-2xl w-full mx-auto flex flex-col gap-4">
			{#if allMastered}
				<div class="rounded-2xl border border-[#6FCF73]/40 bg-[#6FCF73]/10 p-4 text-center">
					<p class="text-3xl mb-1">🏆</p>
					<p class="font-bold text-(--color-text)">{m.practice_mastery_all_title()}</p>
					<p class="text-sm text-(--color-muted)">
						{m.practice_mastery_all_body()}
					</p>
				</div>
			{:else}
				<p class="text-sm text-(--color-muted)">
					{m.practice_mastery_intro()}
				</p>
			{/if}

			{#if chapters.length === 0}
				<p class="text-(--color-muted) text-center py-12">
					{m.practice_mastery_empty_prefix()}<a href="/learn/{data.repertoire?.id}" class="text-(--color-accent) hover:underline">{m.practice_mastery_empty_link()}</a>.
				</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each chapters as c (c.chapter)}
						<li
							class="flex items-center gap-3 p-3 rounded-2xl border border-(--color-border) bg-(--color-surface)"
						>
							<div class="flex-1 min-w-0">
								<p class="font-medium text-(--color-text) truncate">{c.chapter}</p>
								<p class="text-xs text-(--color-muted)">
									{m.practice_mastery_chapter_progress({ learned: c.learned, total: c.total })}
									{#if !c.canRun}· {m.practice_mastery_finish_to_unlock()}{/if}
								</p>
							</div>
							{#if c.mastered}
								<span
									class="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border border-[#6FCF73]/40 bg-[#6FCF73]/10 text-[#4b9e50] dark:text-[#6FCF73]"
								>
									{m.practice_mastery_badge_mastered()}
								</span>
							{/if}
							<button
								onclick={() => startRun(c.chapter)}
								disabled={!c.canRun}
								class="shrink-0 text-sm font-semibold px-3 py-1.5 rounded-xl bg-(--color-accent) text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-(--color-accent-hover)"
							>
								{c.mastered ? m.practice_mastery_run_again() : m.practice_mastery_start_run()}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{:else if phase === 'failed'}
		<div class="flex flex-col items-center justify-center lg:flex-1 text-center gap-4 py-16">
			<p class="text-6xl">🔁</p>
			<h2 class="text-2xl font-bold text-(--color-text)">{m.practice_mastery_failed_title()}</h2>
			<p class="text-(--color-muted) max-w-md">
				{m.practice_mastery_failed_body({ chapter: chapter ?? '' })}
			</p>
			<button
				onclick={() => chapter && startRun(chapter)}
				class="bg-(--color-accent) text-white px-6 py-3 rounded-2xl font-bold hover:bg-(--color-accent-hover) transition"
			>
				{m.practice_mastery_restart_button()}
			</button>
			<button onclick={abandon} class="text-(--color-accent) hover:underline text-sm">{m.practice_mastery_back_to_chapters()}</button>
		</div>
	{:else if phase === 'passed'}
		<div class="flex flex-col items-center justify-center lg:flex-1 text-center gap-4 py-16">
			<p class="text-6xl">🏅</p>
			<h2 class="text-2xl font-bold text-(--color-text)">{m.practice_mastery_passed_title({ chapter: chapter ?? '' })}</h2>
			<p class="text-(--color-muted)">{m.practice_mastery_passed_body()}</p>
			{#if saveError}
				<p class="text-sm text-amber-600 dark:text-amber-400 max-w-md">{saveError}</p>
			{/if}
			<button onclick={abandon} class="bg-(--color-accent) text-white px-6 py-3 rounded-2xl font-bold hover:bg-(--color-accent-hover) transition">
				{m.practice_mastery_back_to_chapters()}
			</button>
		</div>
	{:else}
		<div class="flex flex-col items-center gap-3 lg:flex-1 lg:min-h-0">
			<div class="w-full max-w-2xl flex items-center justify-between gap-3">
				<p class="text-sm font-semibold text-(--color-text)">{chapter}</p>
				<p class="text-sm text-(--color-muted) tabular-nums">{m.practice_mastery_line_label({ progress: progressLabel })}</p>
				<button onclick={abandon} class="text-xs text-(--color-muted) hover:text-(--color-text)">{m.practice_mastery_abandon_button()}</button>
			</div>
			<div class="w-full lg:flex-1 lg:min-h-0 flex items-start justify-center lg:[container-type:size]">
				<ChessBoard
					fen={boardFen}
					orientation={data.repertoire?.color === 'black' ? 'black' : 'white'}
					interactable={!locked}
					onmove={handleMove}
					prefs={data.boardPrefs}
					hintSquare={null}
					arrowMove={null}
					containerFit
				/>
			</div>
		</div>
	{/if}
</main>
