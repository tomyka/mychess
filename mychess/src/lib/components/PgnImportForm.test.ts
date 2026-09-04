// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import PgnImportForm from './PgnImportForm.svelte';

const gotoMock = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...args: any[]) => gotoMock(...args) }));

vi.mock('$lib/googleDrivePicker', () => ({ pickPgnFromGoogleDrive: vi.fn() }));
import { pickPgnFromGoogleDrive } from '$lib/googleDrivePicker';

afterEach(() => {
	cleanup();
	gotoMock.mockClear();
	vi.mocked(pickPgnFromGoogleDrive).mockReset();
	vi.unstubAllGlobals();
});

function fillBasicForm(name: string, pgnText: string) {
	fireEvent.input(screen.getByLabelText('Repertoire Name'), { target: { value: name } });
	fireEvent.input(screen.getByLabelText('Paste PGN text'), { target: { value: pgnText } });
}

/** Step 1 → review screen. Only a multi-chapter PGN gets a review screen. */
async function continueToReview(submitLabel = 'Create Repertoire') {
	await fireEvent.click(screen.getByRole('button', { name: submitLabel }));
	await waitFor(() => expect(screen.getByText('Review chapters')).toBeTruthy());
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

	it('renders the Google Drive import button', () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		expect(screen.getByRole('button', { name: '…or import from Google Drive' })).toBeTruthy();
	});

	it('renders the Google Drive logo in grayscale, not its native colors', () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const button = screen.getByRole('button', { name: '…or import from Google Drive' });
		const svg = button.querySelector('svg');
		expect(svg?.getAttribute('class')).toContain('grayscale');
	});

	it('populates the form from a picked Google Drive file', async () => {
		vi.mocked(pickPgnFromGoogleDrive).mockResolvedValue({ name: 'My Line.pgn', text: '1. e4 e5 *' });
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });

		await fireEvent.click(screen.getByRole('button', { name: '…or import from Google Drive' }));

		await waitFor(() =>
			expect((screen.getByLabelText('Repertoire Name') as HTMLInputElement).value).toBe('My Line')
		);
		expect((screen.getByLabelText('Paste PGN text') as HTMLTextAreaElement).value).toBe('1. e4 e5 *');
	});

	it('does nothing when the Google Drive picker is cancelled', async () => {
		vi.mocked(pickPgnFromGoogleDrive).mockResolvedValue(null);
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });

		await fireEvent.click(screen.getByRole('button', { name: '…or import from Google Drive' }));

		await waitFor(() => expect(pickPgnFromGoogleDrive).toHaveBeenCalled());
		expect((screen.getByLabelText('Paste PGN text') as HTMLTextAreaElement).value).toBe('');
	});

	it('shows an error when the Google Drive picker fails', async () => {
		vi.mocked(pickPgnFromGoogleDrive).mockRejectedValue(new Error('Could not download that file from Google Drive.'));
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });

		await fireEvent.click(screen.getByRole('button', { name: '…or import from Google Drive' }));

		await waitFor(() => expect(screen.getByText('Could not download that file from Google Drive.')).toBeTruthy());
	});

	it('shows the picked filename in a shared caption, not attributed to either specific button', async () => {
		vi.mocked(pickPgnFromGoogleDrive).mockResolvedValue({ name: 'My Line.pgn', text: '1. e4 e5 *' });
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });

		await fireEvent.click(screen.getByRole('button', { name: '…or import from Google Drive' }));

		await waitFor(() => expect(screen.getByText('Selected: My Line.pgn')).toBeTruthy());
	});

	it('clears a stale Google Drive error once a local file is chosen successfully', async () => {
		vi.mocked(pickPgnFromGoogleDrive).mockRejectedValue(new Error('Could not download that file from Google Drive.'));
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });

		await fireEvent.click(screen.getByRole('button', { name: '…or import from Google Drive' }));
		await waitFor(() => expect(screen.getByText('Could not download that file from Google Drive.')).toBeTruthy());

		const file = new File(['1. e4 e5 *'], 'local.pgn', { type: 'text/plain' });
		await fireEvent.change(screen.getByLabelText('…or upload a .pgn file'), { target: { files: [file] } });

		await waitFor(() => expect(screen.queryByText('Could not download that file from Google Drive.')).toBeNull());
	});

	it('disables the submit button and the local file input while a Google Drive pick is in progress', async () => {
		let resolvePick: (value: { name: string; text: string } | null) => void;
		vi.mocked(pickPgnFromGoogleDrive).mockReturnValue(
			new Promise((resolve) => {
				resolvePick = resolve;
			})
		);
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });

		await fireEvent.click(screen.getByRole('button', { name: '…or import from Google Drive' }));

		await waitFor(() =>
			expect((screen.getByRole('button', { name: 'Create Repertoire' }) as HTMLButtonElement).disabled).toBe(true)
		);
		expect((screen.getByLabelText('…or upload a .pgn file') as HTMLInputElement).disabled).toBe(true);

		resolvePick!({ name: 'x.pgn', text: '1. e4 *' });
		await waitFor(() =>
			expect((screen.getByRole('button', { name: 'Create Repertoire' }) as HTMLButtonElement).disabled).toBe(false)
		);
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
		await continueToReview();
		await fireEvent.click(screen.getByRole('button', { name: 'Import 2 chapters' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const firstBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
		const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
		expect(firstBody.name).toBe('My Study'); // repertoire name only — never suffixed with the chapter title
		expect(firstBody.chapterLabel).toBe('Line A'); // bare chapter title, sent separately
		expect(firstBody.existingRepertoireId).toBeUndefined(); // creates the shared repertoire
		expect(firstBody.finalize).toBe(false); // not the last chapter — shape isn't complete yet
		expect(secondBody.name).toBe('My Study');
		expect(secondBody.chapterLabel).toBe('Line B');
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
		await continueToReview();
		await fireEvent.click(screen.getByRole('button', { name: 'Import 2 chapters' }));

		await waitFor(() => expect(screen.getByText('Failed to save moves: boom')).toBeTruthy());
		expect(gotoMock).not.toHaveBeenCalled();
		expect(fetchSpy).toHaveBeenCalledTimes(3);
		expect(fetchSpy.mock.calls[2][0]).toBe('/api/repertoires/r1'); // one DELETE for the one shared repertoire
		expect(fetchSpy.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
	});

	it('does not pass finalize, existingRepertoireId, or chapterLabel for a single-chapter import', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repertoireId: 'r1' }) });
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Rep', '1. e4 e5 *');
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
		expect(body.existingRepertoireId).toBeUndefined();
		expect(body.finalize).toBeUndefined();
		expect(body.chapterLabel).toBeUndefined();
	});

	it('imports a single-game PGN straight from step 1, with no review screen', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repertoireId: 'r1' }) });
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Rep', '1. e4 e5 *');
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		expect(screen.queryByText('Review chapters')).toBeNull();
	});

	it('shows the review screen for a multi-chapter PGN and imports nothing yet', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Study', '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *');
		await continueToReview();

		expect(screen.getByText('Line A')).toBeTruthy();
		expect(screen.getByText('Line B')).toBeTruthy();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('starts with every chapter selected, so an untouched review imports the whole file', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repertoireId: 'r1' }) }));

		fillBasicForm('My Study', '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *');
		await continueToReview();

		expect((screen.getByRole('checkbox', { name: 'Select Line A' }) as HTMLInputElement).checked).toBe(true);
		expect((screen.getByRole('checkbox', { name: 'Select Line B' }) as HTMLInputElement).checked).toBe(true);
		expect(screen.getByRole('button', { name: 'Import 2 chapters' })).toBeTruthy();
	});

	it('imports only the selected chapters', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ repertoireId: 'r1' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ repertoireId: 'r1' }) });
		vi.stubGlobal('fetch', fetchSpy);

		const threeGames =
			'[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Junk"]\n\n1. d4 d5 *\n\n[Event "Line C"]\n\n1. c4 c5 *';
		fillBasicForm('My Study', threeGames);
		await continueToReview();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Junk' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Import 2 chapters' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const labels = fetchSpy.mock.calls.map((call) => JSON.parse(call[1].body).chapterLabel);
		expect(labels).toEqual(['Line A', 'Line C']);
		// finalize is relative to the SELECTED chapters, not the file's.
		expect(JSON.parse(fetchSpy.mock.calls[0][1].body).finalize).toBe(false);
		expect(JSON.parse(fetchSpy.mock.calls[1][1].body).finalize).toBeUndefined();
	});

	it('omits chapterLabel when exactly one chapter of many is selected', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repertoireId: 'r1' }) });
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Study', '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *');
		await continueToReview();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Line B' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Import 1 chapters' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
		expect(body.chapterLabel).toBeUndefined(); // one chapter has nothing to group
		expect(body.finalize).toBeUndefined();
	});

	it('disables the import button when nothing is selected', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		vi.stubGlobal('fetch', vi.fn());

		fillBasicForm('My Study', '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *');
		await continueToReview();

		await fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
		expect((screen.getByRole('button', { name: 'Import 0 chapters' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('goes back to step 1 without importing', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Study', '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *');
		await continueToReview();
		await fireEvent.click(screen.getByRole('button', { name: 'Choose a different file' }));

		await waitFor(() => expect(screen.getByLabelText('Repertoire Name')).toBeTruthy());
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
