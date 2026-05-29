<script lang="ts">
  export type Mood = 'idle' | 'cheer' | 'sad' | 'surprise' | 'sleepy' | 'party';
  type Props = { message?: string; mood?: Mood };
  let { message, mood = 'idle' }: Props = $props();

  const faces: Record<Mood, string> = {
    idle: '😊',
    cheer: '🥳',
    sad: '😢',
    surprise: '😲',
    sleepy: '😴',
    party: '🎉'
  };

  const defaultMessages: Record<Mood, string> = {
    idle: "Let's train!",
    cheer: 'Great move! Keep going!',
    sad: 'Oops! You got this!',
    surprise: 'Whoa! Nice one!',
    sleepy: 'Wake up and review!',
    party: 'Amazing! You are on fire!'
  };

  const displayed = $derived(message ?? defaultMessages[mood]);
</script>

<div class="flex items-end gap-3">
  <div
    class="text-5xl transition-transform duration-300"
    class:scale-125={mood === 'cheer' || mood === 'party'}
    class:opacity-60={mood === 'sleepy'}
    role="img"
    aria-label="Sir Knight chess mascot"
  >
    {faces[mood]} ♞
  </div>
  <div class="bg-slate-700 rounded-2xl rounded-bl-none px-4 py-3 text-sm max-w-[200px] text-white transition-all duration-200">
    {displayed}
  </div>
</div>
