// @vitest-environment jsdom
// mychess/src/routes/settings/settings.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import Settings from './+page.svelte';
import { themeStore } from '$lib/theme.svelte';

beforeEach(() => {
	// themeStore is a module-level singleton shared across every test in
	// this file (and every other file importing it in the same process) —
	// reset it explicitly rather than relying on it starting fresh.
	themeStore.current = 'dark';
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	document.cookie = 'theme=; path=/; max-age=0';
	document.documentElement.classList.remove('dark');
});

describe('Settings appearance toggle', () => {
	it('shows Dark as selected by default', () => {
		const { getByText } = render(Settings, { props: { data: {}, form: null } });
		expect(getByText('Dark').className).toContain('border-indigo-600');
	});

	it('switching to Light removes the dark class and persists the cookie', async () => {
		const { getByText } = render(Settings, { props: { data: {}, form: null } });
		await fireEvent.click(getByText('Light'));
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(document.cookie).toContain('theme=light');
	});

	it('switching back to Dark re-adds the dark class and persists the cookie', async () => {
		const { getByText } = render(Settings, { props: { data: {}, form: null } });
		await fireEvent.click(getByText('Light'));
		await fireEvent.click(getByText('Dark'));
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(document.cookie).toContain('theme=dark');
	});

	it('switching to System resolves against the OS preference', async () => {
		vi.stubGlobal('matchMedia', (query: string) => ({
			matches: query.includes('light'), // simulate an OS set to light
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {}
		}));

		const { getByText } = render(Settings, { props: { data: {}, form: null } });
		await fireEvent.click(getByText('System'));
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(document.cookie).toContain('theme=system');
	});
});
