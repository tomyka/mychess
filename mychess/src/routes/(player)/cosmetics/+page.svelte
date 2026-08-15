<script lang="ts">
  let { data } = $props<{ data: any }>();

  const d = $derived(data as any);
  let selectedTheme = $state<string>((data as any).currentTheme ?? 'classic');
  let selectedAvatar = $state<string>((data as any).currentAvatar ?? 'knight');
  let saving = $state(false);
  let saved = $state(false);

  async function save() {
    saving = true;
    await fetch('/api/cosmetics/equip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId: selectedTheme, avatarId: selectedAvatar })
    });
    saving = false;
    saved = true;
    setTimeout(() => { saved = false; }, 2000);
  }
</script>

<div class="min-h-screen bg-(--color-bg) p-4">
  <div class="max-w-lg mx-auto">
    <div class="flex items-center gap-3 mb-6">
      <a href="/" class="text-2xl">⬅️</a>
      <h1 class="text-2xl font-bold text-(--color-text)">🎨 Customize</h1>
    </div>

    <!-- Avatar Picker -->
    <section class="bg-(--color-surface) rounded-2xl p-5 shadow mb-4">
      <h2 class="font-bold text-lg text-(--color-accent) mb-3">Choose Your Piece</h2>
      <div class="grid grid-cols-6 gap-3">
        {#each d.avatars as av (av.id)}
          <button
            onclick={() => { selectedAvatar = av.id; }}
            class="text-3xl p-2 rounded-xl border-2 transition-all
                   {selectedAvatar === av.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950 scale-110' : 'border-transparent hover:border-indigo-200'}"
            aria-label={av.id}
          >
            {av.emoji}
          </button>
        {/each}
      </div>
    </section>

    <!-- Board Theme Picker -->
    <section class="bg-(--color-surface) rounded-2xl p-5 shadow mb-4">
      <h2 class="font-bold text-lg text-(--color-accent) mb-3">Board Theme</h2>
      <div class="grid grid-cols-3 gap-3">
        {#each d.themes as theme (theme.id)}
          <button
            onclick={() => { selectedTheme = theme.id; }}
            class="rounded-xl overflow-hidden border-2 transition-all
                   {selectedTheme === theme.id ? 'border-indigo-500 scale-105' : 'border-transparent hover:border-indigo-200'}"
            aria-label={theme.name}
          >
            <div class="grid grid-cols-2 h-12">
              <div style="background:{theme.bg}"></div>
              <div style="background:{theme.dark}"></div>
            </div>
            <p class="text-xs font-medium text-center py-1 bg-(--color-bg)">{theme.name}</p>
          </button>
        {/each}
      </div>
    </section>

    <!-- Preview -->
    <section class="bg-(--color-surface) rounded-2xl p-5 shadow mb-4">
      <h2 class="font-bold text-lg text-(--color-accent) mb-3">Preview</h2>
      {#if true}
        {@const theme = d.themes.find((t: any) => t.id === selectedTheme)}
        {@const avatar = d.avatars.find((a: any) => a.id === selectedAvatar)}
        <div class="grid grid-cols-4 grid-rows-4 w-32 h-32 mx-auto rounded-lg overflow-hidden">
          {#each Array(16) as _, i (i)}
            {@const row = Math.floor(i / 4)}
            {@const col = i % 4}
            <div
              style="background:{(row + col) % 2 === 0 ? theme?.bg : theme?.dark};"
              class="flex items-center justify-center text-xl"
            >
              {#if row === 1 && col === 1}
                {avatar?.emoji ?? '♞'}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <button
      onclick={save}
      disabled={saving}
      class="w-full bg-(--color-accent) text-white py-3 rounded-xl font-bold text-lg hover:bg-(--color-accent-hover) transition disabled:opacity-50"
    >
      {#if saving}
        Saving...
      {:else if saved}
        ✅ Saved!
      {:else}
        Save Customization 🎉
      {/if}
    </button>
  </div>
</div>
