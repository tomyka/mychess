<!-- mychess/src/lib/components/RepertoireDiffReview.svelte -->
<!--
	The coach's review of a repertoire re-upload (GitHub issue #118), rendered
	from the `?/preview` action's payload.

	Two ideas run through the whole file:

	1. A change is shown IN PLACE. "Diverges at ply 15" is unreadable to a coach;
	   8.a4 struck through immediately followed by 8.Bd3 is not. That is what
	   `VariationDiff.previousSans` exists for.
	2. Every default is the non-destructive one, so a coach who clicks straight
	   through loses nothing. Reconciliation is also LAZY — it runs on each
	   student's next load — so every number here is a projection and every
	   sentence says "will", never "did".

	This component owns the coach's DECISIONS and reports them upward via
	`ondecisions`; the route owns the form, its action and its hidden inputs. The
	footer's Apply is a plain `type="submit"`, so it submits whichever form the
	route wrapped this component in.
-->
<script lang="ts" module>
	export type ReviewDiffKind = 'unchanged' | 'extended' | 'truncated' | 'diverged' | 'new' | 'removed';

	/**
	 * One classified line. Declared structurally rather than imported from
	 * `$lib/server/repertoire-update`, which is a server-only module — a type-only
	 * import would probably survive the bundler, but "probably" is not a good
	 * reason to point client code at `$lib/server`.
	 */
	export type ReviewDiff = {
		kind: ReviewDiffKind;
		existingKey: string | null;
		sans: string[] | null;
		previousSans: string[] | null;
		commonPlies: number;
		chapterNames: string[];
	};

	export type ReviewPreview = {
		diffs: ReviewDiff[];
		renames: Array<{ from: string; to: string; overlap: number }>;
		impact: {
			counts: Record<ReviewDiffKind, number>;
			demotedLineCount: number;
			removedLearnedCount: number;
			affectedPlayerCount: number;
		};
		absentChapters: string[];
		movesUpdatedAt: string;
		assignedStudentCount: number;
	};

	/** What the coach decided, as the route needs to post it. */
	export type ReviewDecisions = {
		acceptedRenames: Array<{ from: string; to: string }>;
		/**
		 * Chapters the upload does not mention that the coach chose to Keep. Every
		 * line of such a chapter classifies as `removed` — the file simply has no
		 * moves for it — so the apply passes these names to `moveIdsToRetire`,
		 * which excludes their lines from retirement: they stay live and drillable,
		 * exactly as Keep says. A chapter left on Remove has its lines retired.
		 *
		 * The server does not trust these names; it intersects them with the
		 * chapters its own recomputed diff found absent.
		 */
		keptChapters: string[];
	};
</script>

<script lang="ts">
	import { commonPrefixLength } from '$lib/repertoire-diff';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		preview: ReviewPreview;
		repertoireName: string;
		fileName: string;
		assignedStudentCount: number;
		/** True from the moment Apply is pressed until the response lands. */
		submitting: boolean;
		cancelHref: string;
		ondecisions: (decisions: ReviewDecisions) => void;
	};

	let { preview, repertoireName, fileName, assignedStudentCount, submitting, cancelHref, ondecisions }: Props =
		$props();

	/**
	 * Semantic per-class colours, from the `--color-diff-*` tokens defined in
	 * `src/app.css` for BOTH themes. Written out as whole literal class strings
	 * rather than assembled from a name fragment, because Tailwind scans source
	 * text — a composed `bg-(--color-diff-${kind})` would emit no CSS at all.
	 *
	 * Deliberately not the accent: the accent means "the thing you press", these
	 * mean "what happened to this line".
	 */
	const DIFF_STYLE: Record<ReviewDiffKind, { text: string; border: string; stripe: string }> = {
		unchanged: {
			text: 'text-(--color-diff-unchanged)',
			border: 'border-(--color-diff-unchanged)',
			stripe: 'bg-(--color-diff-unchanged)'
		},
		extended: {
			text: 'text-(--color-diff-extended)',
			border: 'border-(--color-diff-extended)',
			stripe: 'bg-(--color-diff-extended)'
		},
		truncated: {
			text: 'text-(--color-diff-truncated)',
			border: 'border-(--color-diff-truncated)',
			stripe: 'bg-(--color-diff-truncated)'
		},
		diverged: {
			text: 'text-(--color-diff-diverged)',
			border: 'border-(--color-diff-diverged)',
			stripe: 'bg-(--color-diff-diverged)'
		},
		new: {
			text: 'text-(--color-diff-new)',
			border: 'border-(--color-diff-new)',
			stripe: 'bg-(--color-diff-new)'
		},
		removed: {
			text: 'text-(--color-diff-removed)',
			border: 'border-(--color-diff-removed)',
			stripe: 'bg-(--color-diff-removed)'
		}
	};

	const KIND_LABEL: Record<ReviewDiffKind, string> = {
		unchanged: m.diff_review_kind_unchanged(),
		extended: m.diff_review_kind_extended(),
		truncated: m.diff_review_kind_truncated(),
		diverged: m.diff_review_kind_diverged(),
		new: m.diff_review_kind_new(),
		removed: m.diff_review_kind_removed()
	};

	/**
	 * Chip and rail order, most-alarming last so the eye lands on the classes
	 * that cost a student something. `truncated` is listed even though the
	 * approved mockup showed five chips: it is a real classification, and a class
	 * missing from the summary would understate the change.
	 */
	const KINDS: ReviewDiffKind[] = ['unchanged', 'extended', 'truncated', 'diverged', 'new', 'removed'];

	/** Which class colours a whole chapter's stripe: the most consequential one it contains. */
	const STRIPE_PRECEDENCE: ReviewDiffKind[] = ['removed', 'diverged', 'new', 'extended', 'truncated', 'unchanged'];

	/** Lines from an untagged upload carry no chapter name; they read as one unnamed chapter. */
	const UNTAGGED = 'untagged';

	type ChapterBucket = {
		key: string;
		label: string;
		diffs: ReviewDiff[];
		counts: Record<ReviewDiffKind, number>;
		absent: boolean;
	};

	function emptyCounts(): Record<ReviewDiffKind, number> {
		return { unchanged: 0, extended: 0, truncated: 0, diverged: 0, new: 0, removed: 0 };
	}

	/**
	 * One bucket per chapter, in first-appearance order, plus any chapter the
	 * upload omits entirely (which may have no lines left to show if its lines
	 * were claimed by lines that stayed).
	 *
	 * A line that two chapters share appears under BOTH — that is what a
	 * transposition is, and hiding it under one of them would make the other
	 * chapter look shorter than it is.
	 */
	const chapters = $derived.by(() => {
		// A plain array plus a linear lookup rather than a Map: chapter counts run
		// in the tens, and `svelte/prefer-svelte-reactivity` (rightly) rejects a
		// mutable Map inside reactive code.
		const buckets: ChapterBucket[] = [];
		const bucket = (key: string, label: string, absent: boolean) => {
			const found = buckets.find((b) => b.key === key);
			if (found) return found;
			const created: ChapterBucket = { key, label, diffs: [], counts: emptyCounts(), absent };
			buckets.push(created);
			return created;
		};

		for (const diff of preview.diffs) {
			const keys = diff.chapterNames.length > 0 ? diff.chapterNames : [UNTAGGED];
			for (const key of keys) {
				const target = bucket(key, key === UNTAGGED ? m.diff_review_untitled_chapter() : key, false);
				target.diffs.push(diff);
				target.counts[diff.kind]++;
			}
		}

		for (const name of preview.absentChapters) bucket(name, name, true).absent = true;

		return buckets;
	});

	let selectedKey = $state<string | null>(null);
	const selected = $derived(chapters.find((c) => c.key === selectedKey) ?? chapters[0] ?? null);

	function stripeOf(counts: Record<ReviewDiffKind, number>): string {
		const kind = STRIPE_PRECEDENCE.find((k) => counts[k] > 0) ?? 'unchanged';
		return DIFF_STYLE[kind].stripe;
	}

	// --- Decision: renames -------------------------------------------------

	/**
	 * Two absent chapters pointing at the SAME new chapter get NO offer, either
	 * of them. Accepting both would silently merge two chapters into one, and a
	 * merge is not undoable from this screen; the coach resolves that by hand.
	 * `detectRenames` already refuses to guess when one absent chapter has two
	 * plausible targets — this is the other direction of the same rule.
	 */
	const timesTargeted = (to: string) => preview.renames.filter((c) => c.to === to).length;

	const offeredRenames = $derived(preview.renames.filter((c) => timesTargeted(c.to) === 1));
	const ambiguousRenames = $derived(preview.renames.filter((c) => timesTargeted(c.to) > 1));

	/** Keyed by the OLD chapter name. Default 'rename', the choice that keeps the chapter's identity. */
	let renameChoice = $state<Record<string, 'rename' | 'separate'>>({});
	const renameOf = (from: string) => renameChoice[from] ?? 'rename';

	const acceptedRenames = $derived(
		offeredRenames.filter((c) => renameOf(c.from) === 'rename').map(({ from, to }) => ({ from, to }))
	);

	// --- Decision: chapters the file does not mention ----------------------

	/**
	 * An accepted rename is not an absent chapter — it moved. A rejected one is,
	 * which is why this list is derived rather than taken from
	 * `preview.absentChapters` verbatim.
	 */
	const omittedChapters = $derived.by(() => {
		const renamedAway = new Set(acceptedRenames.map((r) => r.from));
		return preview.absentChapters
			.filter((name) => !renamedAway.has(name))
			.map((name) => ({
				name,
				lineCount: preview.diffs.filter((d) => d.kind === 'removed' && d.chapterNames.includes(name)).length
			}));
	});

	/** Default 'keep' — the non-destructive choice. */
	let omittedChoice = $state<Record<string, 'keep' | 'remove'>>({});
	const omittedOf = (name: string) => omittedChoice[name] ?? 'keep';

	/**
	 * The chapters the apply must spare. Reported upward so the route can post
	 * them: the retire set is derived from the diff, where every line of an
	 * omitted chapter reads as `removed`, so sparing has to be said out loud or
	 * Keep would retire exactly what it promises to keep.
	 */
	const keptChapters = $derived(omittedChapters.filter((c) => omittedOf(c.name) === 'keep').map((c) => c.name));

	/**
	 * True for a `removed` line that survives anyway, because one of its chapters
	 * is being kept. ANY kept chapter is enough — a line two chapters share is
	 * still drilled by the one that stays — which is the same rule
	 * `moveIdsToRetire` applies, so the row's copy matches what the apply does.
	 */
	const isSpared = (diff: ReviewDiff) =>
		diff.kind === 'removed' && diff.chapterNames.some((name) => keptChapters.includes(name));

	$effect(() => {
		ondecisions({ acceptedRenames, keptChapters });
	});

	// --- Rendering one line's change in place ------------------------------

	type Segment = { sans: string[]; startPly: number; style: string; struck: boolean };

	/**
	 * The line, split into the pieces that get different colours: what both
	 * versions agree on, what this upload drops, and what it puts there instead.
	 * `startPly` is carried so every segment keeps the move numbering of the
	 * position it actually occupies.
	 */
	function segmentsOf(diff: ReviewDiff): Segment[] {
		const previous = diff.previousSans;
		const next = diff.sans;

		// Removed: there is no new version, so the whole old line is struck —
		// unless its chapter is being kept, in which case nothing happens to it and
		// striking it would say the opposite.
		if (!next) {
			if (!previous) return [];
			const spared = isSpared(diff);
			return [
				{
					sans: previous,
					startPly: 0,
					style: spared ? DIFF_STYLE.unchanged.text : DIFF_STYLE.removed.text,
					struck: !spared
				}
			];
		}
		// New: nothing was replaced, so the whole line is new.
		if (!previous) return [{ sans: next, startPly: 0, style: DIFF_STYLE.new.text, struck: false }];

		const common = commonPrefixLength(previous, next);
		const segments: Segment[] = [];
		if (common > 0) {
			segments.push({ sans: next.slice(0, common), startPly: 0, style: 'text-(--color-text)', struck: false });
		}
		// The replaced plies, struck, immediately before their replacement — the
		// whole point of carrying `previousSans`.
		const replaced = previous.slice(common);
		if (replaced.length > 0) {
			segments.push({ sans: replaced, startPly: common, style: DIFF_STYLE.removed.text, struck: true });
		}
		const added = next.slice(common);
		if (added.length > 0) {
			// A replacement reads as diverged; a pure append reads as extended. When
			// a line both diverges and grows, the first new ply is the replacement
			// and the rest is the tail.
			if (replaced.length > 0) {
				segments.push({ sans: added.slice(0, 1), startPly: common, style: DIFF_STYLE.diverged.text, struck: false });
				if (added.length > 1) {
					segments.push({
						sans: added.slice(1),
						startPly: common + 1,
						style: DIFF_STYLE.extended.text,
						struck: false
					});
				}
			} else {
				segments.push({ sans: added, startPly: common, style: DIFF_STYLE.extended.text, struck: false });
			}
		}
		return segments;
	}

	/** Ply 0 is White's first move, so the label only appears on even plies. */
	const moveLabel = (ply: number) => (ply % 2 === 0 ? `${ply / 2 + 1}.` : '');

	/** One muted sentence saying what this line costs, in the future tense it actually happens in. */
	function consequenceOf(diff: ReviewDiff): string {
		switch (diff.kind) {
			case 'unchanged':
				return m.diff_review_consequence_unchanged();
			case 'extended':
				return m.diff_review_consequence_extended({ n: (diff.sans?.length ?? 0) - diff.commonPlies });
			case 'truncated':
				return m.diff_review_consequence_truncated({ n: (diff.previousSans?.length ?? 0) - diff.commonPlies });
			case 'diverged':
				return m.diff_review_consequence_diverged({
					commonPlies: diff.commonPlies,
					moveNumber: Math.floor(diff.commonPlies / 2) + 1
				});
			case 'new':
				return diff.commonPlies > 0
					? m.diff_review_consequence_new_continued({ commonPlies: diff.commonPlies })
					: m.diff_review_consequence_new_fresh();
			case 'removed':
				return isSpared(diff)
					? m.diff_review_consequence_removed_spared()
					: m.diff_review_consequence_removed();
		}
	}

	/**
	 * The row's badge. A `removed` line whose chapter is kept is still classified
	 * `removed` — the file does not contain it — but labelling it Removed beside
	 * a sentence saying it stays would be the same lie this screen used to tell.
	 */
	const badgeOf = (diff: ReviewDiff) => (isSpared(diff) ? m.diff_review_badge_kept() : KIND_LABEL[diff.kind]);

	const styleOf = (diff: ReviewDiff) => (isSpared(diff) ? DIFF_STYLE.unchanged : DIFF_STYLE[diff.kind]);

	// --- Footer verdict ----------------------------------------------------

	const counts = $derived(preview.impact.counts);
	const changedCount = $derived(counts.extended + counts.truncated + counts.diverged);

	/**
	 * Not `counts.removed`: a `removed` line in a chapter the coach kept is not
	 * retired, so counting it here would promise a retirement the apply will not
	 * perform — the coach-facing half of the same fix.
	 */
	const retiredCount = $derived(preview.diffs.filter((d) => d.kind === 'removed' && !isSpared(d)).length);
	const sparedCount = $derived(preview.diffs.filter((d) => isSpared(d)).length);

	const verdict = $derived.by(() => {
		const parts: string[] = [];
		if (counts.new > 0) parts.push(m.diff_review_verdict_add({ n: counts.new }));
		if (changedCount > 0) parts.push(m.diff_review_verdict_reshape({ n: changedCount }));
		if (retiredCount > 0) parts.push(m.diff_review_verdict_retire({ n: retiredCount }));
		if (sparedCount > 0) parts.push(m.diff_review_verdict_spared({ n: sparedCount }));
		if (parts.length === 0) {
			return m.diff_review_verdict_no_changes();
		}
		const shape =
			parts.length === 1
				? parts[0]
				: `${parts.slice(0, -1).join(', ')} ${m.diff_review_verdict_and()} ${parts[parts.length - 1]}`;
		const cost =
			preview.impact.demotedLineCount === 0
				? m.diff_review_cost_none()
				: `${m.diff_review_cost_demoted({
						demotedLineCount: preview.impact.demotedLineCount,
						affectedPlayerCount: preview.impact.affectedPlayerCount,
						assignedStudentCount
					})} ${m.diff_review_cost_students_suffix({ assignedStudentCount })}`;
		return m.diff_review_verdict_wrapper({ shape, cost });
	});
</script>

<section class="space-y-4">
	<!-- 1. Header ------------------------------------------------------------ -->
	<header class="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 shadow-sm">
		<h1 class="text-xl font-bold text-(--color-text)">{m.diff_review_heading()}</h1>
		<p class="mt-1 text-sm text-(--color-muted)">
			<span class="font-medium text-(--color-text)">{repertoireName}</span>
			<span aria-hidden="true"> · </span>
			<span class="break-all">{fileName}</span>
			<span aria-hidden="true"> · </span>
			<span class="tabular-nums">{assignedStudentCount}</span>
			{m.diff_review_header_students_assigned({ count: assignedStudentCount })}
		</p>
	</header>

	<!-- 2. Summary chips + the student cost ---------------------------------- -->
	<div
		class="flex flex-wrap items-center gap-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-4 shadow-sm"
	>
		{#each KINDS as kind (kind)}
			<span
				class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold
				       {counts[kind] > 0
					? `${DIFF_STYLE[kind].border} ${DIFF_STYLE[kind].text}`
					: 'border-(--color-border) text-(--color-muted)'}"
			>
				{KIND_LABEL[kind]}
				<span class="tabular-nums">{counts[kind]}</span>
			</span>
		{/each}
		<p class="ml-auto text-sm text-(--color-muted)">
			<span class="tabular-nums font-semibold text-(--color-text)">{preview.impact.demotedLineCount}</span>
			{m.diff_review_chip_demoted_clause({ count: preview.impact.demotedLineCount })}
			<span class="tabular-nums font-semibold text-(--color-text)">{preview.impact.affectedPlayerCount}</span>
			{m.diff_review_chip_of()}
			<span class="tabular-nums font-semibold text-(--color-text)">{assignedStudentCount}</span>
			{m.diff_review_chip_students_suffix({ count: assignedStudentCount })}
		</p>
	</div>

	<!-- 3. Chapter rail + the selected chapter's lines ----------------------- -->
	<div class="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
		<nav
			class="min-w-0 rounded-xl border border-(--color-border) bg-(--color-surface) p-2 shadow-sm"
			aria-label={m.diff_review_chapters_nav_aria()}
		>
			<ul class="space-y-1">
				{#each chapters as chapter (chapter.key)}
					<li>
						<button
							type="button"
							onclick={() => (selectedKey = chapter.key)}
							aria-current={selected?.key === chapter.key ? 'true' : undefined}
							class="flex w-full items-stretch gap-2 rounded-lg text-left transition-colors
							       {selected?.key === chapter.key
								? 'bg-(--color-bg)'
								: 'hover:bg-(--color-bg) focus:bg-(--color-bg)'}
							       focus:outline-2 focus:outline-offset-2 focus:outline-(--color-accent)"
						>
							<span class="w-[3px] shrink-0 rounded-full {stripeOf(chapter.counts)}" aria-hidden="true"></span>
							<span class="min-w-0 flex-1 px-1 py-2">
								<span class="block truncate text-sm font-medium text-(--color-text)">{chapter.label}</span>
								<span class="mt-0.5 block text-xs text-(--color-muted) tabular-nums">
									{#each KINDS.filter((k) => chapter.counts[k] > 0) as kind (kind)}
										<span class="{DIFF_STYLE[kind].text} me-1.5"
											>{chapter.counts[kind]} {KIND_LABEL[kind].toLowerCase()}</span
										>
									{/each}
									{#if chapter.diffs.length === 0}{m.diff_review_chapter_no_lines()}{/if}
								</span>
								{#if chapter.absent}
									<span
										class="mt-1 inline-block rounded border border-(--color-diff-removed) px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-(--color-diff-removed)"
									>
										{m.diff_review_not_in_file()}
									</span>
								{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		</nav>

		<div class="min-w-0 rounded-xl border border-(--color-border) bg-(--color-surface) shadow-sm">
			{#if !selected || selected.diffs.length === 0}
				<p class="p-4 text-sm text-(--color-muted)">
					{selected?.absent ? m.diff_review_chapter_absent_empty() : m.diff_review_chapter_empty()}
				</p>
			{:else}
				<ul class="max-h-[32rem] divide-y divide-(--color-border) overflow-y-auto">
					{#each selected.diffs as diff, i (diff.existingKey ?? `new-${i}`)}
						<li class="flex min-w-0 items-start gap-3 p-3">
							<span
								class="w-20 shrink-0 rounded-full border px-2 py-0.5 text-center text-xs font-semibold
								       {styleOf(diff).border} {styleOf(diff).text}"
							>
								{badgeOf(diff)}
							</span>
							<div class="min-w-0 flex-1">
								<!-- The move list is the only thing allowed to scroll sideways; the
								     page body never does. -->
								<div class="overflow-x-auto">
									<p class="whitespace-nowrap font-mono text-sm">
										{#each segmentsOf(diff) as segment, s (s)}
											{#each segment.sans as san, p (p)}
												{#if moveLabel(segment.startPly + p)}<span
														class="me-0.5 text-(--color-muted) tabular-nums"
														>{moveLabel(segment.startPly + p)}</span
													>{/if}<span class="me-1.5 {segment.style} {segment.struck ? 'line-through' : ''}"
													>{san}</span
												>
											{/each}
										{/each}
									</p>
								</div>
								<p class="mt-1 text-xs text-(--color-muted)">{consequenceOf(diff)}</p>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>

	<!-- 5a. Rename decisions ------------------------------------------------- -->
	{#each offeredRenames as candidate (candidate.from)}
		<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 shadow-sm">
			<h2 class="text-sm font-semibold text-(--color-text)">
				{m.diff_review_rename_question({ to: candidate.to, from: candidate.from })}
			</h2>
			<p class="mt-1 text-sm text-(--color-muted)">
				<span class="tabular-nums font-medium text-(--color-text)">{Math.round(candidate.overlap * 100)}%</span>
				{m.diff_review_rename_overlap_body({ from: candidate.from, to: candidate.to })}
			</p>
			<div class="mt-3 flex gap-2">
				{#each [{ id: 'rename', label: m.diff_review_rename_choice_rename() }, { id: 'separate', label: m.diff_review_rename_choice_separate() }] as const as option (option.id)}
					<button
						type="button"
						onclick={() => (renameChoice = { ...renameChoice, [candidate.from]: option.id })}
						aria-pressed={renameOf(candidate.from) === option.id}
						class="flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors
						       focus:outline-2 focus:outline-offset-2 focus:outline-(--color-accent)
						       {renameOf(candidate.from) === option.id
							? 'border-(--color-accent) text-(--color-text)'
							: 'border-(--color-border) text-(--color-muted) hover:border-(--color-accent) hover:text-(--color-text) focus:border-(--color-accent) focus:text-(--color-text)'}"
					>
						{option.label}
					</button>
				{/each}
			</div>
		</div>
	{/each}

	<!-- 5b. Chapters the file does not mention -------------------------------- -->
	{#if omittedChapters.length > 0}
		<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 shadow-sm">
			<h2 class="text-sm font-semibold text-(--color-text)">
				{m.diff_review_omitted_heading({ n: omittedChapters.length })}
			</h2>
			<p class="mt-1 text-sm text-(--color-muted)">
				{m.diff_review_omitted_explainer()}
			</p>
			{#each ambiguousRenames as candidate (candidate.from)}
				<p class="mt-2 text-sm text-(--color-muted)">
					{m.diff_review_ambiguous_rename({ from: candidate.from, to: candidate.to })}
				</p>
			{/each}
			<ul class="mt-3 space-y-2">
				{#each omittedChapters as chapter (chapter.name)}
					<li class="flex flex-wrap items-center gap-2">
						<span class="min-w-0 flex-1 truncate text-sm font-medium text-(--color-text)">{chapter.name}</span>
						<span class="text-xs text-(--color-muted) tabular-nums">
							{m.diff_review_omitted_line_count({ n: chapter.lineCount })}
						</span>
						<span class="flex gap-2">
							{#each [{ id: 'keep', label: m.diff_review_omitted_choice_keep() }, { id: 'remove', label: m.diff_review_omitted_choice_remove() }] as const as option (option.id)}
								<button
									type="button"
									onclick={() => (omittedChoice = { ...omittedChoice, [chapter.name]: option.id })}
									aria-pressed={omittedOf(chapter.name) === option.id}
									class="rounded-xl border-2 px-3 py-1.5 text-sm font-semibold transition-colors
									       focus:outline-2 focus:outline-offset-2 focus:outline-(--color-accent)
									       {omittedOf(chapter.name) === option.id
										? 'border-(--color-accent) text-(--color-text)'
										: 'border-(--color-border) text-(--color-muted) hover:border-(--color-accent) hover:text-(--color-text) focus:border-(--color-accent) focus:text-(--color-text)'}"
								>
									{option.label}
								</button>
							{/each}
						</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- 6. Verdict and the two ways out --------------------------------------- -->
	<footer class="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 shadow-sm">
		<p class="text-sm text-(--color-text)">{verdict}</p>
		<p class="mt-1 text-xs text-(--color-muted)">
			{m.diff_review_footer_note()}
		</p>
		<div class="mt-3 flex items-center justify-end gap-3">
			<a
				href={cancelHref}
				class="rounded-xl border border-(--color-border) px-4 py-2 text-sm font-semibold text-(--color-muted) transition-colors hover:border-(--color-accent) hover:text-(--color-text) focus:border-(--color-accent) focus:text-(--color-text) focus:outline-2 focus:outline-offset-2 focus:outline-(--color-accent)"
			>
				{m.diff_review_cancel_button()}
			</a>
			<button
				type="submit"
				disabled={submitting}
				class="rounded-xl bg-(--color-accent) px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-(--color-accent-hover) focus:bg-(--color-accent-hover) focus:outline-2 focus:outline-offset-2 focus:outline-(--color-accent) disabled:cursor-not-allowed disabled:opacity-60"
			>
				{submitting ? m.diff_review_applying() : m.diff_review_apply_button()}
			</button>
		</div>
	</footer>
</section>
