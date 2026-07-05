<script lang="ts">
  let { form } = $props<{ form: any }>();
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-8 p-6">
  <div class="text-center">
    <div class="flex items-center justify-center gap-2 font-bold text-gray-900 mb-3">
      <span class="text-3xl">♟</span>
      <span class="text-2xl">MyChess</span>
    </div>
    <h1 class="text-2xl font-bold text-gray-900">Welcome! What's your name?</h1>
    <p class="mt-1 text-gray-500">So we can set up your dashboard</p>
  </div>

  {#if form?.error}
    <p class="text-red-600 bg-red-50 border border-red-200 px-4 py-2 rounded-xl text-sm">{form.error}</p>
  {/if}

  <form method="POST" class="flex flex-col gap-4 w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="first_name">First Name</label>
        <input
          id="first_name"
          name="first_name"
          type="text"
          required
          placeholder="e.g. Magnus"
          class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="last_name">Last Name</label>
        <input
          id="last_name"
          name="last_name"
          type="text"
          required
          placeholder="e.g. Carlsen"
          class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>
    </div>

    <button
      type="submit"
      class="bg-indigo-600 text-white py-3 rounded-xl font-bold text-base hover:bg-indigo-700 transition-colors">
      Get started →
    </button>
  </form>
</main>
