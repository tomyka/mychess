import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			workbox: {
				// Deliberately no `wasm` here: globPatterns is the PRECACHE list, so
				// adding the 7.3MB engine would download it during service-worker
				// install for every visitor — the exact cost #124 exists to avoid. It
				// is cached on first real use by the runtime rule below instead.
				globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
				// The engine is the one asset big enough that re-fetching it matters,
				// and Workbox skips >2MiB files in the precache anyway.
				maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
				runtimeCaching: [
					{
						// CacheFirst, not StaleWhileRevalidate: the filename carries the
						// engine version (`stockfish-18-lite-single`), so a cached copy can
						// never be stale — a new build is a new URL. One download per
						// device per version, and explore mode then works offline.
						urlPattern: /\/stockfish\/.*\.(?:wasm|js|cjs)$/i,
						handler: 'CacheFirst',
						options: {
							cacheName: 'stockfish-engine',
							// A handful of entries covers the current build plus whatever a
							// previous one left behind; the year matches the immutable
							// cache-control in vercel.json.
							expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 365 },
							cacheableResponse: { statuses: [200] }
						}
					},
					{
						urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
						handler: 'NetworkFirst',
						options: {
							cacheName: 'supabase-api',
							expiration: { maxEntries: 100, maxAgeSeconds: 3600 }
						}
					}
				]
			},
			manifest: {
				name: 'MyChess',
					short_name: 'MyChess',
				description: 'Learn chess openings. Have fun. Level up!',
				theme_color: '#1e293b',
				background_color: '#0f172a',
				display: 'standalone',
				orientation: 'portrait',
				start_url: '/',
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
				]
			}
		})
	],
	test: {
		include: ['src/**/*.test.ts'],
		// Default environment is 'node'; component tests opt into 'jsdom' via a
		// `// @vitest-environment jsdom` pragma comment in the test file itself.
		// (Vitest 4 removed the `environmentMatchGlobs` option that used to be
		// used here for path-based environment switching.)
		environment: 'node',
		setupFiles: ['./src/test-setup.ts'],
		alias: {
			$lib: '/src/lib'
		},
		// jsdom's CSS parsing pulls in @asamuzakjp/css-color, which `require()`s
		// the ESM-only @csstools/css-calc — Node throws ERR_REQUIRE_ESM on any
		// version where require(esm) isn't unflagged yet (Node 20.x before the
		// backport; fine on Node ≥22 without this). Worse, vitest's forks pool
		// swallows a worker's failure to even start as an "unhandled error"
		// rather than a test failure, so `vitest run` exits 0 with the affected
		// files silently missing from the run instead of failing loudly (see
		// GitHub issue #55). Passing this flag to every worker process fixes it
		// on all supported Node versions — it's a harmless no-op where the
		// feature is already stable and unflagged.
		execArgv: ['--experimental-require-module']
	},
	// Under Vitest (any pool), module resolution happens through Vite's SSR
	// pipeline even for jsdom-environment test files, so the "svelte" package
	// would otherwise resolve its server-only build (breaking `mount()` from
	// @testing-library/svelte). Forcing the browser export condition during
	// test runs only (never for the real dev/build) fixes that; see
	// https://svelte.dev/docs/svelte/testing#Vitest.
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined
});
