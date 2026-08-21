// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import NewGame from './+page.svelte';

// Same reason as repertoires/new/new.test.ts: googleDrivePicker.ts reads
// $env/dynamic/public at module scope, which throws under Vitest's
// browser-condition SSR resolution outside a real SvelteKit runtime.
vi.mock('$lib/googleDrivePicker', () => ({ pickPgnFromGoogleDrive: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { goto } from '$app/navigation';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('upload a game page', () => {
	it('renders the heading and PGN paste field', () => {
		render(NewGame);
		expect(screen.getByRole('heading', { name: 'Upload a game' })).toBeTruthy();
		expect(screen.getByLabelText('Paste PGN text')).toBeTruthy();
	});

	it('renders the Google Drive logo in grayscale, not its native colors', () => {
		render(NewGame);
		const button = screen.getByRole('button', { name: /import from Google Drive/ });
		const svg = button.querySelector('svg');
		expect(svg?.getAttribute('class')).toContain('grayscale');
	});

	it('shows an error and does not submit when the PGN has more than one game', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		render(NewGame);
		const textarea = screen.getByLabelText('Paste PGN text') as HTMLTextAreaElement;
		await fireEvent.input(textarea, {
			target: { value: '[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. d4 d5 *' }
		});
		const form = textarea.closest('form') as HTMLFormElement;
		await fireEvent.submit(form);
		expect(screen.getByText(/upload one game at a time/i)).toBeTruthy();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('submits the PGN and playedAs, then navigates to the new game on success', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			json: async () => ({ id: 'new-game-id' })
		} as Response);

		render(NewGame);
		const textarea = screen.getByLabelText('Paste PGN text') as HTMLTextAreaElement;
		await fireEvent.input(textarea, { target: { value: '1. e4 e5 *' } });
		await fireEvent.click(screen.getByRole('button', { name: 'White' }));
		const form = textarea.closest('form') as HTMLFormElement;
		await fireEvent.submit(form);

		await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
		expect(fetchSpy).toHaveBeenCalledWith('/api/games', expect.objectContaining({ method: 'POST' }));
		const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
		expect(body).toEqual({ pgn: '1. e4 e5 *', playedAs: 'white' });

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/games/new-game-id'));
	});
});
