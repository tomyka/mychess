<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	let { data } = $props<{ data: any }>();

	type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

	const LEVEL_LABEL: Record<Tier, () => string> = {
		bronze: m.level_bronze,
		silver: m.level_silver,
		gold: m.level_gold,
		platinum: m.level_platinum
	};

	function levelLabel(level: Tier | null): string {
		return level ? LEVEL_LABEL[level]() : m.level_none();
	}

	const LEVEL_BADGE_CLASS: Record<Tier, string> = {
		bronze: 'border-[#B08D57]/40 bg-[#B08D57]/10 text-[#8a6b3f] dark:text-[#cda876]',
		silver: 'border-[#A8A8A8]/40 bg-[#A8A8A8]/10 text-[#6b6b6b] dark:text-[#c7c7c7]',
		gold: 'border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#8a6d10] dark:text-[#e0c15c]',
		platinum: 'border-[#6FCF73]/40 bg-[#6FCF73]/10 text-[#4b9e50] dark:text-[#6FCF73]'
	};

	function badgeClass(level: Tier | null): string {
		return level ? LEVEL_BADGE_CLASS[level] : 'border-(--color-border) bg-(--color-bg) text-(--color-muted)';
	}
</script>

<svelte:head>
	<!-- Fallback name reused verbatim from Learn's per-repertoire page. -->
	<title>{m.seo_practice_mastery_title({ name: data.repertoire?.name ?? m.learn_repertoire_fallback_name() })}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg) p-4 max-w-2xl mx-auto pb-24">
	<div class="mb-4 flex items-center gap-3 flex-wrap">
		<a href="/practice/{data.repertoire?.id}" class="text-(--color-muted) text-sm hover:text-(--color-text)">
			{m.practice_levels_back_link()}
		</a>
		<h1 class="text-base font-bold text-(--color-text) flex-1 min-w-0 truncate">
			{m.practice_levels_page_heading({ name: data.repertoire?.name })}
		</h1>
	</div>

	<div class="max-w-2xl w-full mx-auto flex flex-col gap-4">
		<p class="text-sm text-(--color-muted)">{m.practice_levels_intro()}</p>

		{#if data.chapters.length > 0}
			<div class="flex items-center gap-2">
				<span class="text-sm text-(--color-muted)">{m.practice_levels_repertoire_summary_prefix()}</span>
				<span
					class="text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded-full border {badgeClass(data.repertoireLevel)}"
				>
					{levelLabel(data.repertoireLevel)}
				</span>
			</div>
		{/if}

		{#if data.chapters.length === 0}
			<p class="text-(--color-muted) text-center py-12">
				{m.practice_levels_empty_prefix()}<a href="/learn/{data.repertoire?.id}" class="text-(--color-accent) hover:underline">{m.practice_levels_empty_link()}</a>.
			</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each data.chapters as c (c.chapter)}
					<li class="flex items-center gap-3 p-3 rounded-2xl border border-(--color-border) bg-(--color-surface)">
						<div class="flex-1 min-w-0">
							<p class="font-medium text-(--color-text) truncate">{c.chapter}</p>
							<p class="text-xs text-(--color-muted)">
								{m.practice_levels_chapter_progress({ learned: c.learned, total: c.total })}
							</p>
						</div>
						<span
							class="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border {badgeClass(c.level)}"
						>
							{levelLabel(c.level)}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
