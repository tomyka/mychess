<!-- mychess/src/lib/components/PracticeStatusStrip.svelte -->
<script module lang="ts">
	export type PracticeStripState =
		| 'silent'
		| 'blind'
		| 'wrong'
		| 'correct'
		| 'autoplay'
		| 'retest-cue'
		// Practice only (#98): this line just went back to Learn. Distinct from
		// 'wrong', which means "try again" — here there is no trying again.
		| 'demoted';
</script>

<script lang="ts">
	let { state, onhint }: { state: PracticeStripState; onhint?: () => void } = $props();

	// Mobile stacks this strip directly on top of the board, so a caller that
	// wants to offer a hint hands it in here rather than rendering a row of its
	// own below the strip: that row mounted and unmounted on every phase change
	// (hint taken, correct move, autoplay intro, cue) and shoved the board up
	// and down mid-drill (#113). Sharing the strip's one fixed-height slot means
	// the board's top edge never moves — at the cost of the two never being
	// visible together, which is why the offer only takes the slot in 'blind',
	// the one state where the player is being asked to recall a move. Move
	// feedback always wins the slot back, and 'silent' means a teaching arrow is
	// up: the move is already being shown, so offering to show it is noise.
	const hintable = $derived(!!onhint && state === 'blind');

	// Keyed over the FULL union (including 'silent') so `TONE[state]`/`COPY[state]`/
	// `ICON[state]` type-check without narrowing — indexing with `Exclude<
	// PracticeStripState, 'silent'>` instead would make `svelte-check` reject
	// `state` (whose type still includes 'silent') as a key, since template
	// expressions on the host element's own attributes don't narrow the way a
	// nested `{#if}`'s own contents do.
	const ICON: Record<PracticeStripState, string> = {
		silent: '',
		blind: '',
		wrong: '✗',
		correct: '✓',
		autoplay: '',
		'retest-cue': '🧠',
		demoted: '↩'
	};

	const COPY: Record<PracticeStripState, string> = {
		silent: '',
		blind: 'Play it from memory',
		wrong: 'Not that move — try again',
		correct: 'Correct',
		autoplay: 'Replaying what you already know…',
		'retest-cue': 'Nice — now play it from memory',
		// Kept short on purpose: at 320px the longer wording wrapped to a second
		// line, which is a height change and therefore a board shift (#113).
		demoted: 'Back to Learn — needs teaching again'
	};

	const TONE: Record<PracticeStripState, string> = {
		silent: 'border-transparent bg-transparent',
		blind: 'border-(--color-border) bg-(--color-surface) text-(--color-muted)',
		wrong: 'border-[#F28B82]/40 bg-[#F28B82]/10 text-[#F28B82]',
		correct: 'border-[#6FCF73]/40 bg-[#6FCF73]/10 text-[#6FCF73]',
		autoplay: 'border-(--color-border) bg-(--color-surface) text-(--color-muted)',
		'retest-cue':
			'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
		demoted:
			'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
	};

	// While the hint owns the slot it owns the strip's tone too, so the offer
	// reads as an offer rather than as a status. That swap is mobile-only — the
	// desktop sidebar has its own hint button, so `lg:` puts the state's real
	// tone back (mobile-first, so these min-width utilities beat the base ones
	// above them). Only 'blind' can be reached here; the rest exist to keep the
	// record keyed over the full union, same as TONE above.
	const HINT_TONE =
		'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300';
	const TONE_LG: Record<PracticeStripState, string> = {
		silent: '',
		blind: 'lg:border-(--color-border) lg:bg-(--color-surface) lg:text-(--color-muted)',
		wrong: '',
		correct: '',
		autoplay: '',
		'retest-cue': '',
		demoted: ''
	};
</script>

<!-- The slot's height is deliberately over-reserved and its line-height
     pinned (`min-h-12` against a 46px worst case of `leading-5` + p-3 +
     border): mobile stacks this directly on the board, so ANY content-driven
     height difference between states moves the board (#113). Without both,
     'silent' measured 44px, the copy states 46px, and the hint offer 50px —
     the emoji sitting on its own taller line box — for a visible shift on
     every phase change. Nothing in here may set its own font-size. -->
<p
	role="status"
	class="mb-3 shrink-0 min-h-12 flex items-center justify-center rounded-2xl border p-3 text-center text-sm leading-5 font-semibold shadow-sm {hintable
		? `${HINT_TONE} ${TONE_LG[state]}`
		: TONE[state]}"
>
	{#if hintable}
		<!-- `-m-3 p-3` makes the button cover the slot's whole 48px box instead
		     of just its own 20px text line: the offer LOOKS like a card, so a
		     finger lands anywhere on it, and every tap outside the text used to
		     hit the <p> and do nothing. -->
		<button
			onclick={onhint}
			class="lg:hidden -m-3 flex w-full items-center justify-center gap-1.5 p-3"
		>
			<span aria-hidden="true">💡</span> Need a hint?
		</button>
	{/if}
	<span class={hintable ? 'hidden lg:inline' : ''}>
		{#if ICON[state]}<span aria-hidden="true">{ICON[state]}</span> {/if}{COPY[state]}
	</span>
</p>
