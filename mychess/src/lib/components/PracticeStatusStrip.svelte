<!-- mychess/src/lib/components/PracticeStatusStrip.svelte -->
<script module lang="ts">
	export type PracticeStripState = 'silent' | 'blind' | 'wrong' | 'correct' | 'autoplay' | 'retest-cue';
</script>

<script lang="ts">
	let { state }: { state: PracticeStripState } = $props();

	// Keyed over the FULL union (including 'silent') so `TONE[state]`/`COPY[state]`
	// type-check without narrowing — indexing with `Exclude<PracticeStripState,
	// 'silent'>` instead would make `svelte-check` reject `state` (whose type
	// still includes 'silent') as a key, since template expressions don't
	// narrow the way an `{#if}` block's own contents do.
	const COPY: Record<PracticeStripState, string> = {
		silent: '',
		blind: 'Play it from memory',
		wrong: '✗ Not that move — try again',
		correct: '✓ Correct',
		autoplay: 'Replaying what you already know…',
		'retest-cue': '🧠 Nice — now play it from memory'
	};

	const TONE: Record<PracticeStripState, string> = {
		silent: 'border-transparent bg-transparent',
		blind: 'border-(--color-border) bg-(--color-surface) text-(--color-muted)',
		wrong: 'border-[#F28B82]/40 bg-[#F28B82]/10 text-[#F28B82]',
		correct: 'border-[#6FCF73]/40 bg-[#6FCF73]/10 text-[#6FCF73]',
		autoplay: 'border-(--color-border) bg-(--color-surface) text-(--color-muted)',
		'retest-cue':
			'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
	};
</script>

<p
	role="status"
	class="mb-3 shrink-0 min-h-[2.75rem] flex items-center justify-center rounded-2xl border p-3 text-center text-sm font-semibold shadow-sm {TONE[state]}"
>
	{COPY[state]}
</p>
