// mychess/src/routes/(player)/repertoires/new/new.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import NewRepertoire from './+page.svelte';

// NewRepertoire renders PgnImportForm, which imports googleDrivePicker.ts —
// that module reads `$env/dynamic/public` at module scope, which throws
// under Vitest's browser-condition SSR resolution (there's no real
// SvelteKit runtime here to populate `window.__sveltekit_dev`). Mocking the
// module out (same as PgnImportForm.test.ts does for its own Google Drive
// tests) avoids ever touching that import chain — this test only cares that
// the page renders and delegates to PgnImportForm, not about the picker.
vi.mock('$lib/googleDrivePicker', () => ({ pickPgnFromGoogleDrive: vi.fn() }));

afterEach(() => cleanup());

describe('new repertoire page', () => {
	it('renders the heading and delegates to PgnImportForm', () => {
		render(NewRepertoire);
		expect(screen.getByRole('heading', { name: 'Create Repertoire' })).toBeTruthy();
		expect(screen.getByLabelText('Repertoire Name')).toBeTruthy();
		expect(screen.getByLabelText('Paste PGN text')).toBeTruthy();
	});
});
