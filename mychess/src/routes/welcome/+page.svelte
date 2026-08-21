<script lang="ts">
  import { m } from '$lib/paraglide/messages';

  let { form } = $props<{ form: any }>();
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-(--color-bg) gap-8 p-6">
  <div class="text-center">
    <div class="flex items-center justify-center gap-2 font-bold text-(--color-text) mb-3">
      <span class="text-3xl">♟</span>
      <span class="text-2xl">MyChess</span>
    </div>
    <h1 class="text-2xl font-bold text-(--color-text)">{m.welcome_title()}</h1>
    <p class="mt-1 text-(--color-muted)">{m.welcome_subtitle()}</p>
  </div>

  {#if form?.error}
    <p class="text-red-600 bg-red-50 border border-red-200 px-4 py-2 rounded-xl text-sm dark:bg-red-950 dark:border-red-800 dark:text-red-400">{form.error}</p>
  {/if}

  <form method="POST" class="flex flex-col gap-4 w-full max-w-sm bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm p-8">
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-(--color-text) mb-1" for="first_name">{m.welcome_first_name_label()}</label>
        <input
          id="first_name"
          name="first_name"
          type="text"
          required
          placeholder={m.welcome_first_name_placeholder()}
          class="w-full bg-(--color-surface) border border-(--color-border) rounded-lg px-4 py-2 text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-(--color-text) mb-1" for="last_name">{m.welcome_last_name_label()}</label>
        <input
          id="last_name"
          name="last_name"
          type="text"
          required
          placeholder={m.welcome_last_name_placeholder()}
          class="w-full bg-(--color-surface) border border-(--color-border) rounded-lg px-4 py-2 text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>
    </div>

    <button
      type="submit"
      class="bg-(--color-accent) text-white py-3 rounded-xl font-bold text-base hover:bg-(--color-accent-hover) transition-colors">
      {m.welcome_get_started()}
    </button>
  </form>
</main>
