// mychess/src/routes/(player)/repertoires/new/new.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import NewRepertoire from './+page.svelte';

afterEach(() => cleanup());

describe('new repertoire page', () => {
	it('renders the heading and delegates to PgnImportForm', () => {
		render(NewRepertoire);
		expect(screen.getByRole('heading', { name: 'Create Repertoire' })).toBeTruthy();
		expect(screen.getByLabelText('Repertoire Name')).toBeTruthy();
		expect(screen.getByLabelText('Paste PGN text')).toBeTruthy();
	});
});
