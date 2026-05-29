<script lang="ts">
	type Props = { done?: number; goal?: number };
	let { done = 0, goal = 10 }: Props = $props();

	const pct = $derived(Math.min(100, (done / goal) * 100));
	const completed = $derived(done >= goal);
</script>

<div class="flex flex-col items-center gap-2">
	<div class="relative w-20 h-20">
		<svg class="w-full h-full -rotate-90" viewBox="0 0 36 36">
			<circle cx="18" cy="18" r="15.9" fill="none" stroke="rgb(51 65 85)" stroke-width="3.5"/>
			<circle
				cx="18" cy="18" r="15.9" fill="none"
				stroke={completed ? '#4ade80' : '#facc15'}
				stroke-width="3.5"
				stroke-linecap="round"
				stroke-dasharray="{pct} 100"
				class="transition-all duration-700"
			/>
		</svg>
		<div class="absolute inset-0 flex items-center justify-center">
			<span class="text-lg font-bold">{completed ? '✅' : done}/{goal}</span>
		</div>
	</div>
	<p class="text-xs text-slate-400 font-medium">Daily Goal</p>
</div>
