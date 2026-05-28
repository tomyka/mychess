<script lang="ts">
	import { createSupabaseClient } from '$lib/supabase/client';

	const sb = createSupabaseClient();

	async function signIn() {
		await sb.auth.signInWithOAuth({
			provider: 'google',
			options: { redirectTo: `${window.location.origin}/auth/callback` }
		});
	}
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-8 p-6">
	<div class="text-center">
		<h1 class="text-6xl font-bold text-yellow-400">KidChess</h1>
		<p class="mt-3 text-slate-300 text-lg">Learn openings. Have fun. Level up!</p>
		<p class="mt-1 text-slate-500 text-sm">Your chess journey starts here</p>
	</div>
	<div class="flex flex-col items-center gap-4 w-full max-w-sm">
		<button
			onclick={signIn}
			class="flex items-center gap-3 bg-white text-slate-900 px-8 py-4 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl hover:scale-105 transition-all w-full justify-center"
		>
			<svg class="w-6 h-6 shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
				<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
				<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
				<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
				<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
			</svg>
			Sign in with Google
		</button>
	</div>
</main>
