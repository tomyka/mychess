// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import PgnImportForm from './PgnImportForm.svelte';

const gotoMock = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...args: any[]) => gotoMock(...args) }));

afterEach(() => {
	cleanup();
	gotoMock.mockClear();
	vi.unstubAllGlobals();
});

function fillBasicForm(name: string, pgnText: string) {
	fireEvent.input(screen.getByLabelText('Repertoire Name'), { target: { value: name } });
	fireEvent.input(screen.getByLabelText('Paste PGN text'), { target: { value: pgnText } });
}

describe('PgnImportForm', () => {
	it('renders all the expected fields', () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		expect(screen.getByLabelText('Repertoire Name')).toBeTruthy();
		expect(screen.getByText('White')).toBeTruthy();
		expect(screen.getByText('Black')).toBeTruthy();
		expect(screen.getByLabelText('Paste PGN text')).toBeTruthy();
		expect(screen.getByLabelText('…or upload a .pgn file')).toBeTruthy();
	});

	it('shows an error instead of submitting when the PGN is missing (name has no native required check)', async () => {
		// pgn_text has no native `required` attribute (either it or a chosen
		// file can supply the PGN) — unlike #name, which does and would block
		// the submit event entirely before this handler ever runs.
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		fireEvent.input(screen.getByLabelText('Repertoire Name'), { target: { value: 'My Rep' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		expect(screen.getByText('Name and PGN are required')).toBeTruthy();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('shows the parse error instead of submitting for an invalid PGN', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Rep', 'not a real pgn');
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		expect(screen.getByText('No valid games found in PGN')).toBeTruthy();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('imports a single-game PGN as one chapter and redirects on success', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ repertoireId: 'r1' })
		});
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Rep', '1. e4 e5 *');
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, opts] = fetchSpy.mock.calls[0];
		expect(url).toBe('/api/repertoires/import-chapter');
		const body = JSON.parse(opts.body);
		expect(body.name).toBe('My Rep'); // single chapter — no " — <chapter>" suffix
		expect(body.color).toBe('white');
	});

	it('imports a multi-game PGN one chapter at a time into ONE shared repertoire', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ repertoireId: 'r1' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ repertoireId: 'r1' }) });
		vi.stubGlobal('fetch', fetchSpy);

		const twoGames = '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *';
		fillBasicForm('My Study', twoGames);
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const firstBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
		const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
		expect(firstBody.name).toBe('My Study — Line A');
		expect(firstBody.existingRepertoireId).toBeUndefined(); // creates the shared repertoire
		expect(firstBody.finalize).toBe(false); // not the last chapter — shape isn't complete yet
		expect(secondBody.name).toBe('My Study — Line B');
		expect(secondBody.existingRepertoireId).toBe('r1'); // appends onto chapter 1's repertoire
		expect(secondBody.finalize).toBeUndefined(); // last chapter — defaults to true, computes real shape
	});

	it('rolls back the shared repertoire when a later chapter fails', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ repertoireId: 'r1' }) }) // chapter 1 succeeds
			.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Failed to save moves: boom' }) }) // chapter 2 fails
			.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }); // the DELETE rollback call
		vi.stubGlobal('fetch', fetchSpy);

		const twoGames = '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *';
		fillBasicForm('My Study', twoGames);
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		await waitFor(() => expect(screen.getByText('Failed to save moves: boom')).toBeTruthy());
		expect(gotoMock).not.toHaveBeenCalled();
		expect(fetchSpy).toHaveBeenCalledTimes(3);
		expect(fetchSpy.mock.calls[2][0]).toBe('/api/repertoires/r1'); // one DELETE for the one shared repertoire
		expect(fetchSpy.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
	});

	it('does not pass finalize or existingRepertoireId for a single-chapter import', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repertoireId: 'r1' }) });
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Rep', '1. e4 e5 *');
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
		expect(body.existingRepertoireId).toBeUndefined();
		expect(body.finalize).toBeUndefined();
	});
});
