<!-- mychess/src/lib/components/RepertoireUpdatedBanner.svelte -->
<script lang="ts">
	/**
	 * Tells a student that their COACH moved the material, rather than leaving a
	 * mastery bar that dropped on its own to read as a bug (GitHub issue #118).
	 * That attribution is the whole job: the student did nothing wrong and
	 * nothing is broken, so this is informational — not a warning, not an error.
	 *
	 * `lineCount` comes from `coachUpdatedLineCount` in
	 * `$lib/server/coach-update-notice`, which is self-clearing: each line the
	 * student re-learns drops out of it, so the count falls to 0 and this
	 * component renders NOTHING with no dismissal state anywhere.
	 *
	 * Deliberately says nothing about how mastery or demotion works. The student
	 * needs to know who changed it, not the mechanism; the mechanism is already
	 * explained where the line is re-taught.
	 *
	 * No `aria-live`. This is present at page load, not an update announced into
	 * a live page — a live region would have a screen reader interrupt itself to
	 * read content the normal reading order covers anyway.
	 */
	import { m } from '$lib/paraglide/messages';

	let { lineCount }: { lineCount: number } = $props();

	// Dismissal is per page view only, on purpose: nothing is persisted, so the
	// notice comes back on the next load and cannot get stuck hidden while lines
	// are still outstanding. The count itself is what actually clears it.
	let dismissed = $state(false);
</script>

{#if lineCount > 0 && !dismissed}
	<div
		class="mb-3 shrink-0 flex items-start gap-3 rounded-2xl border border-(--color-border) bg-(--color-surface) p-3 text-sm shadow-sm"
	>
		<span aria-hidden="true" class="text-(--color-accent)">↻</span>
		<p class="flex-1 text-(--color-text)">
			{m.practice_coach_update_notice({ lineCount })}
		</p>
		<button
			type="button"
			onclick={() => (dismissed = true)}
			aria-label={m.practice_dismiss_coach_notice_label()}
			class="shrink-0 rounded-lg px-1.5 text-(--color-muted) hover:bg-(--color-border)/40 hover:text-(--color-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
		>
			<span aria-hidden="true">✕</span>
		</button>
	</div>
{/if}
