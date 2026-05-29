<script lang="ts">
  let role = $state('kid');
  let { form } = $props<{ form: any }>();
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-8 p-6">
  <div class="text-center">
    <div class="flex items-center justify-center gap-2 font-bold text-gray-900 mb-3">
      <span class="text-3xl">♟</span>
      <span class="text-2xl">MyChess</span>
    </div>
    <h1 class="text-2xl font-bold text-gray-900">Welcome! Tell us about yourself</h1>
    <p class="mt-1 text-gray-500">So we can set up your dashboard</p>
  </div>

  {#if form?.error}
    <p class="text-red-600 bg-red-50 border border-red-200 px-4 py-2 rounded-xl text-sm">{form.error}</p>
  {/if}

  <form method="POST" class="flex flex-col gap-4 w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
    <label class="flex flex-col gap-1.5">
      <span class="text-sm font-medium text-gray-700">Your name</span>
      <input
        name="display_name"
        required
        placeholder="e.g. Alex"
        class="rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </label>

    <div class="flex gap-3">
      {#each [{ id: 'kid', label: 'I am a Player' }, { id: 'coach', label: 'I am a Coach' }] as r}
        <button
          type="button"
          onclick={() => (role = r.id)}
          class="flex-1 py-3 px-2 rounded-xl font-semibold transition-all border-2
                 {role === r.id ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}"
        >
          <span class="text-sm">{r.label}</span>
        </button>
      {/each}
    </div>

    <input type="hidden" name="role" value={role} />

    <button
      type="submit"
      class="bg-indigo-600 text-white py-3 rounded-xl font-bold text-base hover:bg-indigo-700 transition-colors">
      Get started →
    </button>
  </form>
</main>
