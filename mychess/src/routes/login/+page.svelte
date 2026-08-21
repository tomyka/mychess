<script lang="ts">
  import { sendMagicLink } from '$lib/auth/client';
  import { m } from '$lib/paraglide/messages';

  let { data } = $props<{ data: { error: string | null } }>();

  let email = $state('');
  let keepSignedIn = $state(true);
  let error = $state(data.error ?? '');
  let loading = $state(false);
  let sent = $state(false);

  async function magicLink() {
    if (!email.trim()) { error = m.login_error_enter_email(); return; }
    loading = true; error = '';
    const r = await sendMagicLink(email.trim(), keepSignedIn);
    loading = false;
    if (r.ok) sent = true;
    else error = r.error ?? m.login_error_could_not_send_link();
  }
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-(--color-bg) gap-8 p-6">
  <div class="text-center">
    <a href="/" class="flex items-center justify-center gap-2 font-bold text-(--color-text) mb-2">
      <span class="text-3xl">♟</span>
      <span class="text-2xl">MyChess</span>
    </a>
    <p class="text-(--color-muted)">{m.login_subtitle()}</p>
  </div>

  <div class="bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm p-8 w-full max-w-sm flex flex-col gap-5">
    {#if error}
      <p class="text-red-600 dark:text-red-400 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 dark:bg-red-950 dark:border-red-800">{error}</p>
    {/if}

    {#if sent}
      <div class="text-center space-y-2">
        <h1 class="text-lg font-semibold text-(--color-text)">{m.login_check_email_title()}</h1>
        <p class="text-sm text-(--color-muted)">{m.login_check_email_body_prefix()}<span class="font-medium">{email}</span>{m.login_check_email_body_suffix()}</p>
        <button onclick={() => { sent = false; }} class="text-sm text-(--color-accent) hover:underline">{m.login_use_different_email()}</button>
      </div>
    {:else}
      <a
        href={`/auth/google?persist=${keepSignedIn ? '1' : '0'}`}
        class="flex items-center justify-center gap-2 border border-(--color-border) rounded-xl py-3 font-medium text-(--color-text) hover:bg-gray-50 dark:hover:bg-gray-800 transition">
        <span aria-hidden="true">G</span> {m.login_continue_with_google()}
      </a>

      <div class="flex items-center gap-3 text-xs text-(--color-muted)">
        <span class="flex-1 border-t border-(--color-border)"></span>{m.login_or_divider()}<span class="flex-1 border-t border-(--color-border)"></span>
      </div>

      <div>
        <label class="block text-sm font-medium text-(--color-text) mb-1" for="email">{m.login_email_label()}</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          placeholder={m.login_email_placeholder()}
          class="w-full border border-(--color-border) rounded-lg px-4 py-2.5 text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <label class="flex items-center gap-2 text-sm text-(--color-muted)">
        <input type="checkbox" bind:checked={keepSignedIn} class="rounded border-(--color-border) text-(--color-accent) focus:ring-indigo-500" />
        {m.login_keep_signed_in()}
      </label>

      <button
        onclick={magicLink}
        disabled={loading}
        class="bg-(--color-accent) text-white py-3 rounded-xl font-semibold hover:bg-(--color-accent-hover) transition disabled:opacity-50">
        {loading ? m.login_please_wait() : m.login_email_magic_link()}
      </button>
    {/if}

    <a href="/" class="text-center text-sm text-(--color-muted) hover:underline">{m.login_continue_without_account()}</a>
  </div>
</main>
