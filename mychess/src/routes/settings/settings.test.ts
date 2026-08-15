// @vitest-environment jsdom
// mychess/src/routes/settings/settings.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import Settings from './+page.svelte';
import { themeStore } from '$lib/theme.svelte';
import { enginePrefStore } from '$lib/enginePref.svelte';

beforeEach(() => {
	// themeStore/enginePrefStore are module-level singletons shared across
	// every test in this file (and every other file importing them in the
	// same process) — reset them explicitly rather than relying on a fresh
	// start.
	themeStore.current = 'dark';
	enginePrefStore.enabled = false;
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	document.cookie = 'theme=; path=/; max-age=0';
	document.cookie = 'engine_enabled=; path=/; max-age=0';
	document.documentElement.classList.remove('dark');
});

describe('Settings appearance toggle', () => {
	it('shows Dark as selected by default', () => {
		const { getByText } = render(Settings, { props: { data: {}, form: null } });
		expect(getByText('Dark').className).toContain('border-(--color-accent)');
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

describe('Settings engine toggle', () => {
	it('is unchecked by default', () => {
		const { getByLabelText } = render(Settings, { props: { data: {}, form: null } });
		expect((getByLabelText('Show engine evaluation during practice') as HTMLInputElement).checked).toBe(false);
	});

	it('checking it persists the cookie', async () => {
		const { getByLabelText } = render(Settings, { props: { data: {}, form: null } });
		const checkbox = getByLabelText('Show engine evaluation during practice') as HTMLInputElement;
		await fireEvent.click(checkbox);
		expect(checkbox.checked).toBe(true);
		expect(document.cookie).toContain('engine_enabled=true');
	});

	it('unchecking it again persists the cookie', async () => {
		const { getByLabelText } = render(Settings, { props: { data: {}, form: null } });
		const checkbox = getByLabelText('Show engine evaluation during practice') as HTMLInputElement;
		await fireEvent.click(checkbox);
		await fireEvent.click(checkbox);
		expect(checkbox.checked).toBe(false);
		expect(document.cookie).toContain('engine_enabled=false');
	});
});
