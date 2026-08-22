<script lang="ts">
  import { getLocale, setLocale } from '$lib/paraglide/runtime';
  import { m } from '$lib/paraglide/messages';

  const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'lt', label: 'Lietuviškai' }
  ] as const;

  let open = $state(false);
  const current = LANGUAGES.find((l) => l.code === getLocale()) ?? LANGUAGES[0];

  async function select(code: 'en' | 'lt') {
    open = false;
    if (code === getLocale()) return;

    try {
      await fetch('/api/locale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: code })
      });
    } catch (err) {
      // Best-effort persistence — for a signed-out visitor this only affects
      // the cookie Paraglide's own setLocale() writes, so failure here
      // doesn't block the switch. For a signed-in user, a failed write means
      // the reload below will resolve back to the DB's stored locale
      // (custom-profileLocale outranks the cookie) — logged below so it's at
      // least debuggable, not silently lost.
      console.error('Failed to persist locale preference', err);
    }

    setLocale(code);
  }
</script>

<div class="relative">
  <button
    onclick={() => { open = !open; }}
    aria-label={m.language_switcher_label()}
    class="text-(--color-muted) hover:text-gray-900 dark:hover:text-gray-200 font-medium text-sm uppercase"
  >
    {current.code}
  </button>

  {#if open}
    <button
      class="fixed inset-0 z-10"
      aria-label={m.nav_close_menu()}
      onclick={() => { open = false; }}
    ></button>
    <div class="absolute right-0 mt-2 w-36 bg-(--color-surface) border border-(--color-border) rounded-xl shadow-lg z-20 py-1 text-sm">
      {#each LANGUAGES as lang (lang.code)}
        <button
          onclick={() => select(lang.code)}
          class="block w-full text-left px-4 py-2 text-(--color-text) hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          {lang.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
