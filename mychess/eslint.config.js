// mychess/eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default tseslint.config(
	{
		ignores: [
			'.svelte-kit/',
			'build/',
			'.vercel/',
			'.netlify/',
			'static/',
			'node_modules/',
			'src/lib/openings/eco-data.ts' // generated data file
		]
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	...svelte.configs.recommended,
	security.configs.recommended,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser
			}
		}
	},
	{
		rules: {
			// This codebase's own convention (CLAUDE.md): `requireAccount` can't
			// narrow its return type, so call sites use `user!.id` deliberately.
			'@typescript-eslint/no-non-null-assertion': 'off',
			// Server-only Supabase query builders and cheerio/webhook payloads are
			// routinely typed `any` at the boundary (see CLAUDE.md's `as any`
			// mapping convention) — flag it as a warning to clean up over time,
			// not a hard failure that would block the existing baseline.
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			// Extremely noisy against ordinary `obj[key]` access with no real
			// injection risk in this codebase (server-scoped config/lookup maps,
			// not user-controlled property names) — see the plugin's own docs on
			// its high false-positive rate for this rule.
			'security/detect-object-injection': 'off',
			// This rule wants every goto()/href to route through SvelteKit's
			// $app/paths `resolve()` for typed-route safety. This app doesn't use
			// a non-root `base` path or typed route params anywhere today, so
			// there's no live bug this catches yet — adopting it means rewriting
			// ~25 call sites' route IDs correctly, which is a deliberate future
			// project, not a mechanical lint fix. Revisit if the app ever adds a
			// base path or route param typing.
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		files: ['**/*.test.ts', 'tests/**'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'security/detect-object-injection': 'off'
		}
	}
);
