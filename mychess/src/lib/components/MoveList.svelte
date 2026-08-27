<!-- mychess/src/lib/components/MoveList.svelte -->
<!--
	The sidebar's "This line" move list, chess.com-style: one row per full
	move, White's and Black's SAN in their own columns. Not clickable —
	reviewing a position is already what MoveNavRow's prev/next buttons do,
	and click-to-jump is a distinct feature nobody asked for (see
	2026-08-26-drill-sidebar-nav-design.md).

	Shared by Learn and Practice, same reasoning as MoveNavRow/ExploreControls:
	one copy means a formatting fix can't land on one page and miss the other.
-->
<script lang="ts">
	import type { MoveRow } from '$lib/mastery/variations';

	let { rows }: { rows: MoveRow[] } = $props();
</script>

{#if rows.length === 0}
	<p class="text-sm text-(--color-muted)">—</p>
{:else}
	<div class="grid grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-1 text-sm">
		{#each rows as row (row.number)}
			<span class="text-(--color-muted) tabular-nums">{row.number}.</span>
			<span class="text-(--color-text) font-mono">{row.white}</span>
			<span class="text-(--color-text) font-mono">{row.black ?? ''}</span>
		{/each}
	</div>
{/if}
