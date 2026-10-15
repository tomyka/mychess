<script lang="ts">
  import { getLocale, setLocale } from '$lib/paraglide/runtime';
  import { m } from '$lib/paraglide/messages';

  const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'lt', label: 'Lietuviškai' }
  ] as const;

  const PERSIST_FAILED_KEY = 'mychess:locale-persist-failed';

  // setLocale() below reloads the page immediately, so component-local state
  // set right before it would never paint — stash the failure in
  // sessionStorage and surface it once the freshly-reloaded page re-mounts.
  function consumePersistFailedFlag(): boolean {
    if (typeof sessionStorage === 'undefined') return false;
    const failed = sessionStorage.getItem(PERSIST_FAILED_KEY) !== null;
    if (failed) sessionStorage.removeItem(PERSIST_FAILED_KEY);
    return failed;
  }

  let open = $state(false);
  let persistFailed = $state(consumePersistFailedFlag());
  const current = LANGUAGES.find((l) => l.code === getLocale()) ?? LANGUAGES[0];

  async function select(code: 'en' | 'lt') {
    open = false;
    if (code === getLocale()) return;

    let failed: boolean;
    try {
      const res = await fetch('/api/locale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: code })
      });
      failed = !res.ok;
    } catch (err) {
      // Best-effort persistence — for a signed-out visitor this only affects
      // the cookie Paraglide's own setLocale() writes, so failure here
      // doesn't block the switch. For a signed-in user, a failed write means
      // the reload below will resolve back to the DB's stored locale
      // (profiles.locale outranks the cookie), so it's surfaced to them
      // rather than silently reverting with no explanation.
      console.error('Failed to persist locale preference', err);
      failed = true;
    }

    if (failed && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(PERSIST_FAILED_KEY, '1');
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

  {#if persistFailed}
    <div
      role="alert"
      class="absolute right-0 mt-2 w-56 text-red-600 dark:text-red-400 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2 dark:bg-red-950 dark:border-red-800 shadow-lg z-20 flex items-start gap-2"
    >
      <span class="flex-1">{m.language_switcher_persist_failed()}</span>
      <button
        onclick={() => { persistFailed = false; }}
        aria-label={m.nav_close_menu()}
        class="leading-none"
      >
        &times;
      </button>
    </div>
  {/if}
</div>
