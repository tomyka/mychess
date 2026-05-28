<script lang="ts">
	type Mood = 'happy' | 'thinking' | 'celebrate' | 'sad';
	type Props = { message?: string; mood?: Mood };
	let { message = "Let's train!", mood = 'happy' }: Props = $props();

	const faces: Record<Mood, string> = {
		happy: '😄',
		thinking: '🤔',
		celebrate: '🎉',
		sad: '😢'
	};
</script>

<div class="flex items-end gap-3">
	<div class="text-5xl" role="img" aria-label="Sir Knight chess mascot">
		{faces[mood]} ♞
	</div>
	<div class="bg-slate-700 rounded-2xl rounded-bl-none px-4 py-3 text-sm max-w-[200px]">
		{message}
	</div>
</div>
