import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Pinned to Stockholm to match the Supabase project's region (North EU) —
		// without this, Vercel defaults to iad1 (US East), forcing every
		// server-side Supabase round trip across the Atlantic for no reason.
		adapter: adapter({ runtime: 'nodejs22.x', regions: ['arn1'] }),
		// Detect a newer deployment while a tab is still open (we redeploy on
		// every push to main) and fall back to a full page reload on the next
		// navigation instead of fetching a chunk hash that no longer exists.
		version: {
			pollInterval: 60000
		}
	}
};

export default config;
