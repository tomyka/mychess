import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({ runtime: 'nodejs22.x' }),
		// Detect a newer deployment while a tab is still open (we redeploy on
		// every push to main) and fall back to a full page reload on the next
		// navigation instead of fetching a chunk hash that no longer exists.
		version: {
			pollInterval: 60000
		}
	}
};

export default config;
