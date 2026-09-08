// mychess/src/lib/components/VariationPicker.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import { mount, unmount, flushSync } from 'svelte';
import { reactiveProps } from './reactive-props.svelte';
import VariationPicker from './VariationPicker.svelte';
import { UNTAGGED_CHAPTER } from '$lib/mastery/variations';

afterEach(() => {
	cleanup();
	// A few tests below patch this directly (jsdom doesn't implement it at
	// all) — undo it so it doesn't leak into unrelated tests/files sharing
	// this worker.
	delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

// Builds a realistic VariationStep[] with correctly alternating side-to-move
// and move-number FEN fields, so moveSequenceLabel's numbering (used for
// move-group folder labels) is accurate.
function path(sans: string[]) {
	let moveNumber = 1;
	let whiteToMove = true;
	return sans.map((san, i) => {
		const fromFen = `x ${whiteToMove ? 'w' : 'b'} - - 0 ${moveNumber}`;
		if (!whiteToMove) moveNumber++;
		whiteToMove = !whiteToMove;
		return { moveId: `m${i}`, san, fromFen, toFen: 'x', isPlayerTurn: true };
	});
}

/**
 * One learn unit as `/api/repertoires/[id]/learn-units` returns it. Note what
 * is NOT here: no `solved`, no `locked`, no `pausedAtCeiling`, no
 * `ceilingMoveCount`. Every unit the endpoint returns is learnable right now
 * (GitHub issue #182), which is why this component has no status to render and
 * no disabled state to test.
 */
function unit(variationKey: string, sans: string[]) {
	return { unitKey: `u:${variationKey}`, label: `label:${variationKey}`, path: path(sans), variationKey };
}

function chapter(
	name: string | null,
	units: ReturnType<typeof unit>[],
	opts: { band?: string | null; complete?: boolean; learnedInBand?: number } = {}
) {
	return {
		chapter: name,
		band: opts.band === undefined ? 'bronze' : opts.band,
		level: null,
		complete: opts.complete ?? false,
		learnedInBand: opts.learnedInBand ?? 0,
		totalInBand: (opts.learnedInBand ?? 0) + units.length,
		units
	};
}

const respondWith = (chapters: ReturnType<typeof chapter>[]) => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ chapters }) });

// u1/u2 share their first 5 full moves (10 plies) before diverging on move
// 6 — the fixed grouping window (FIRST_MOVES_GROUP_PLIES = 10) buckets them
// into one folder. u3 is a short, unrelated line in a different chapter.
const SHARED = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'];
const RESPONSE = [
	chapter('Ruy Lopez', [unit('v1', [...SHARED, 'Re1']), unit('v2', [...SHARED, 'd3'])]),
	chapter('Italian Game', [unit('v3', ['d4', 'd5', 'c4'])])
];

describe('VariationPicker', () => {
	it('loads learn units and shows chapters as top-level groups', async () => {
		const fetchSpy = respondWith(RESPONSE);
		vi.stubGlobal('fetch', fetchSpy);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => expect(screen.getByText('Ruy Lopez')).toBeTruthy());
		expect(screen.getByText('Italian Game')).toBeTruthy();
		expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/learn-units');
	});

	it('drills into a chapter to show its first-5-moves folder, then into that folder to reach the leaf units', async () => {
		vi.stubGlobal('fetch', respondWith(RESPONSE));
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));

		// The folder is labelled with the shared opening moves, plus its count.
		const folder = screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/);
		expect(folder.closest('button')!.textContent).toContain('(2)');

		await fireEvent.click(folder);
		expect(screen.getByText('label:v1')).toBeTruthy();
		expect(screen.getByText('label:v2')).toBeTruthy();
	});

	it('selecting a leaf unit calls onselect with its representative variation key', async () => {
		const onselect = vi.fn();
		vi.stubGlobal('fetch', respondWith(RESPONSE));
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/));
		await fireEvent.click(screen.getByText('label:v2'));

		expect(onselect).toHaveBeenCalledWith('v2');
	});

	it('the "Back" button returns from the folder to the chapter list', async () => {
		vi.stubGlobal('fetch', respondWith(RESPONSE));
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/));
		expect(screen.getByText('label:v1')).toBeTruthy();

		await fireEvent.click(screen.getByText('← Back'));
		expect(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/)).toBeTruthy();

		await fireEvent.click(screen.getByText('← Back'));
		expect(screen.getByText('Italian Game')).toBeTruthy();
	});

	it('skips the chapter level entirely for a chapterless repertoire, still bucketing by the first-5-moves window', async () => {
		// The endpoint reports a chapterless repertoire as one `chapter: null`
		// flat pool.
		vi.stubGlobal('fetch', respondWith([chapter(null, [unit('v1', [...SHARED, 'Re1']), unit('v2', [...SHARED, 'd3'])])]));
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		// Straight to the folder list — no chapter tier, and no "Back" out of it.
		await waitFor(() => expect(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/)).toBeTruthy());
		expect(screen.queryByText('← Back')).toBeNull();
	});

	it('a folder holding a single unit selects it directly instead of drilling into a list of one', async () => {
		const onselect = vi.fn();
		vi.stubGlobal('fetch', respondWith([chapter('Italian Game', [unit('v3', ['d4', 'd5', 'c4'])])]));
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Italian Game'));
		await fireEvent.click(screen.getByText('Italian Game'));

		// Rendered as its own leaf row (own label, no count), not a folder.
		const row = screen.getByText('label:v3');
		expect(row.closest('button')!.textContent).not.toContain('(1)');
		await fireEvent.click(row);
		expect(onselect).toHaveBeenCalledWith('v3');
	});

	it('offers untagged lines in their own bucket, listed last, in an otherwise-chaptered repertoire', async () => {
		vi.stubGlobal(
			'fetch',
			respondWith([chapter('Ruy Lopez', [unit('v1', ['e4', 'e5'])]), chapter(UNTAGGED_CHAPTER, [unit('v9', ['d4', 'd5'])])])
		);
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		const labels = screen.getAllByRole('button').map((b) => b.textContent?.trim());
		expect(labels).toEqual(expect.arrayContaining(['Ruy Lopez', UNTAGGED_CHAPTER]));
		expect(labels.indexOf(UNTAGGED_CHAPTER)).toBeGreaterThan(labels.indexOf('Ruy Lopez'));
	});

	it('calls onclose when the close button is clicked', async () => {
		const onclose = vi.fn();
		vi.stubGlobal('fetch', respondWith(RESPONSE));
		render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose } });

		await waitFor(() => screen.getByText('Ruy Lopez'));
		await fireEvent.click(screen.getByLabelText('Close'));
		expect(onclose).toHaveBeenCalled();
	});

	describe('learned content is absent, never decorated (GitHub issue #182)', () => {
		it('renders no status icon and no disabled row anywhere', async () => {
			vi.stubGlobal('fetch', respondWith(RESPONSE));
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/));

			const buttons = screen.getAllByRole('button');
			expect(buttons.some((b) => b.hasAttribute('disabled'))).toBe(false);
			for (const icon of ['🔒', '⏳', '✓']) {
				expect(document.body.textContent).not.toContain(icon);
			}
		});

		it('omits a chapter that has nothing left to learn, rather than listing a dead end', async () => {
			vi.stubGlobal(
				'fetch',
				respondWith([
					chapter('Ruy Lopez', [unit('v1', ['e4', 'e5'])]),
					chapter('Finished', [], { band: null, complete: true })
				])
			);
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			expect(screen.queryByText('Finished')).toBeNull();
		});

		it('says there is nothing left to learn once every chapter is complete', async () => {
			vi.stubGlobal('fetch', respondWith([chapter('Finished', [], { band: null, complete: true })]));
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => expect(screen.getByText(/nothing left to learn/i)).toBeTruthy());
		});

		it('shows a load error rather than the nothing-left message when the fetch fails', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => expect(screen.getByText(/couldn't load/i)).toBeTruthy());
			expect(screen.queryByText(/nothing left to learn/i)).toBeNull();
		});
	});

	describe('inline variant (GitHub issue #93)', () => {
		it('renders no backdrop or close button', async () => {
			vi.stubGlobal('fetch', respondWith(RESPONSE));
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline' } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			expect(screen.queryByLabelText('Close')).toBeNull();
		});

		it('re-fetches when the active variation changes, not just once at mount (GitHub issue #175)', async () => {
			// The inline rail is resident for the whole Learn session and never
			// remounts. Without a live re-fetch its unit list would freeze at
			// whatever it was on first load — and now that a learned unit
			// DISAPPEARS rather than being re-rendered with a tick, a stale list
			// is more visible than it used to be, not less.
			const fetchSpy = respondWith(RESPONSE);
			vi.stubGlobal('fetch', fetchSpy);
			const { rerender } = render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v1' }
			});

			await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
			await rerender({ repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v2' });
			await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
		});

		it('does not let a slow, superseded fetch response overwrite fresher data (GitHub issue #175)', async () => {
			let resolveFirst!: (value: unknown) => void;
			const fetchSpy = vi
				.fn()
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							resolveFirst = resolve;
						})
				)
				.mockResolvedValueOnce({ ok: true, json: async () => ({ chapters: RESPONSE }) });
			vi.stubGlobal('fetch', fetchSpy);
			const { rerender } = render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v1' }
			});

			// A second load fires (and resolves) before the first one does.
			await rerender({ repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v3' });
			await waitFor(() => screen.getByText('label:v3'));

			// The stale first response lands last and must be discarded.
			resolveFirst({ ok: true, json: async () => ({ chapters: [] }) });
			await waitFor(() => expect(screen.getByText('label:v3')).toBeTruthy());
			expect(screen.queryByText(/nothing left to learn/i)).toBeNull();
		});

		it('auto-opens straight to the chapter and folder holding the current unit', async () => {
			vi.stubGlobal('fetch', respondWith(RESPONSE));
			render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v3' }
			});

			// v3 is alone in its folder under Italian Game, so it surfaces
			// directly — no chapter list, no folder drill-down needed.
			await waitFor(() => expect(screen.getByText('label:v3')).toBeTruthy());
		});

		it('highlights the active unit row', async () => {
			vi.stubGlobal('fetch', respondWith(RESPONSE));
			render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v3' }
			});

			await waitFor(() => screen.getByText('label:v3'));
			expect(screen.getByText('label:v3').closest('button')!.className).toContain('ring-2');
		});

		it('scrolls the active unit row into view when it renders directly as a sole folder (GitHub issue #174)', async () => {
			// jsdom doesn't implement scrollIntoView at all — stand one in so the
			// action (`scrollIntoViewIfActive`) has something to call.
			const scrollIntoView = vi.fn();
			HTMLElement.prototype.scrollIntoView = scrollIntoView;
			vi.stubGlobal('fetch', respondWith(RESPONSE));
			render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v3' }
			});

			await waitFor(() => screen.getByText('label:v3'));
			expect(scrollIntoView).toHaveBeenCalled();
		});

		it('re-scrolls when the active unit moves to a different, already-mounted row in the same open folder (no remount)', async () => {
			// v1/v2 share their first 10 plies (groupByFirstMoves's own window)
			// and diverge only after it, so both land in ONE folder that requires
			// drilling in — both rows mount together, and neither row's own DOM
			// node is destroyed when the active one changes from one to the
			// other. A mount-only action (no `update`) would only ever scroll the
			// FIRST of the two to become active, never the second.
			const scrollIntoView = vi.fn();
			HTMLElement.prototype.scrollIntoView = scrollIntoView;
			vi.stubGlobal('fetch', respondWith([chapter('Ruy Lopez', [unit('v1', [...SHARED, 'Re1']), unit('v2', [...SHARED, 'd3'])])]));
			const { rerender } = render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v1' }
			});

			await waitFor(() => screen.getByText('label:v1'));
			screen.getByText('label:v2'); // both rows already mounted side by side
			expect(scrollIntoView).toHaveBeenCalledTimes(1);

			await rerender({ repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v2' });
			await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
		});

		it('floats the folder holding the current unit to the very front (GitHub issue #178)', async () => {
			vi.stubGlobal(
				'fetch',
				respondWith([
					chapter(null, [
						unit('p1', ['Pe4', 'Pe5', 'Pnf3', 'Pnc6']),
						unit('p2', ['Pe4', 'Pe5', 'Pnf3', 'Pnc6']),
						unit('solo', ['Sa1', 'Sa2'])
					])
				])
			);
			render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'solo' }
			});

			await waitFor(() => screen.getByText('label:solo'));
			// `solo` is a folder-of-one that renders as its own row; floated to
			// the front, it comes before the two-member P folder.
			const labels = screen.getAllByRole('button').map((b) => b.textContent?.trim() ?? '');
			expect(labels.findIndex((l) => l.includes('label:solo'))).toBeLessThan(labels.findIndex((l) => l.includes('Pe4')));
		});

		it('shows the chapter’s band and its progress within that band', async () => {
			vi.stubGlobal('fetch', respondWith([chapter('Ruy Lopez', [unit('v1', ['e4', 'e5'])], { learnedInBand: 3 })]));
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline' } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			const button = screen.getByText('Ruy Lopez').closest('button')!;
			expect(button.textContent).toContain('Bronze');
			expect(button.textContent).toContain('3/4');
		});

		it('does not auto-open a second time after the player navigates away, even though currentVariationKey is unchanged', async () => {
			vi.stubGlobal('fetch', respondWith(RESPONSE));
			render(VariationPicker, {
				props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'inline', currentVariationKey: 'v3' }
			});

			await waitFor(() => screen.getByText('label:v3'));
			// Back out to the chapter list manually.
			await fireEvent.click(screen.getByText('← Back'));
			expect(screen.getByText('Ruy Lopez')).toBeTruthy();
			expect(screen.queryByText('label:v3')).toBeNull();
		});
	});

	it('keeps a manually drilled-into folder resolving to itself after a float-to-front reorder shifts its position (regression for GitHub issue #178)', async () => {
		// The MODAL variant is used deliberately: it has no auto-open effect
		// (that's inline-only), so nothing re-navigates on a
		// currentVariationKey change — isolating whether `openFolderKey` itself
		// survives the reordering, independent of the inline rail's own
		// separate re-sync behavior.
		//
		// P and Q are both real (2-member) folders; P sorts before Q
		// (tie-broken by first-appearance) and both sort before the solo `a`.
		// Floating `a` shifts every earlier folder down by one, moving Q from
		// index 1 to index 2. Floating a member of P is a no-op (P is already
		// first), so Q reverts to index 1 — an index captured as "2" while `a`
		// was active would resolve to the WRONG folder once P becomes active.
		vi.stubGlobal(
			'fetch',
			respondWith([
				chapter(null, [
					unit('p1', ['Pe4', 'Pe5', 'Pnf3', 'Pnc6', 'Pbb5', 'Pa6']),
					unit('p2', ['Pe4', 'Pe5', 'Pnf3', 'Pnc6', 'Pbb5', 'Pa6']),
					unit('q1', ['Qd4', 'Qd5', 'Qc4', 'Qc6', 'Qnf3', 'Qbf5']),
					unit('q2', ['Qd4', 'Qd5', 'Qc4', 'Qc6', 'Qnf3', 'Qbf5']),
					unit('a', ['Sa1', 'Sa2'])
				])
			])
		);
		const { rerender } = render(VariationPicker, {
			props: { repertoireId: 'rep-1', onselect: vi.fn(), variant: 'modal', currentVariationKey: 'a' }
		});

		// `a` floats to the front; Q sits at index 2 behind it and P.
		await waitFor(() => screen.getByText('label:a'));
		await fireEvent.click(screen.getByText(/Qd4 Qd5/));
		expect(screen.getByText('label:q1')).toBeTruthy();
		expect(screen.getByText('label:q2')).toBeTruthy();

		// Active moves to p1 (inside P). P was already first in the unfloated
		// base order, so this is a no-op for P's own position — but `a` is no
		// longer floated, so Q reverts from index 2 to index 1.
		await rerender({ repertoireId: 'rep-1', onselect: vi.fn(), variant: 'modal', currentVariationKey: 'p1' });

		// Still resolves to Q's own two members — not whatever folder a stale
		// index (captured as 2) would now point at instead.
		await waitFor(() => expect(screen.getByText('label:q1')).toBeTruthy());
		expect(screen.getByText('label:q2')).toBeTruthy();
		expect(screen.queryByText('label:a')).toBeNull();
	});

	describe('selecting a chapter (GitHub issue #170)', () => {
		it('picks the chapter’s first unit as the representative', async () => {
			const onselect = vi.fn();
			vi.stubGlobal('fetch', respondWith(RESPONSE));
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));
			expect(onselect).toHaveBeenCalledWith('v1');
		});

		it('calls a distinct onselectchapter callback instead of onselect when one is provided, and still opens the chapter', async () => {
			const onselect = vi.fn();
			const onselectchapter = vi.fn();
			vi.stubGlobal('fetch', respondWith(RESPONSE));
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onselectchapter, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			expect(onselectchapter).toHaveBeenCalledWith('v1');
			expect(onselect).not.toHaveBeenCalled();
			// Still navigated into the chapter's folder list.
			expect(screen.getByText(/1\.e4 e5 2\.Nf3 Nc6/)).toBeTruthy();
		});

		it('falls back to onselect when no onselectchapter is provided', async () => {
			const onselect = vi.fn();
			vi.stubGlobal('fetch', respondWith(RESPONSE));
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Italian Game'));
			await fireEvent.click(screen.getByText('Italian Game'));
			expect(onselect).toHaveBeenCalledWith('v3');
		});
	});
});

describe('staleness signals (GitHub issue #176)', () => {
	/**
	 * These mount by hand, with props wrapped in `$state`, instead of using
	 * `render` + `rerender` like every other test here. `rerender` RE-MOUNTS the
	 * component, so its mount-time `$effect` runs again and a
	 * "re-fetched after the prop changed" assertion passes even when the
	 * dependency it claims to prove has been deleted — verified by removing the
	 * dependency and watching the `rerender` version still pass. Mutating one
	 * field of a live `$state` props object is what the real parent does, and it
	 * fails correctly when the dependency is gone.
	 */
	function mountPicker(attemptsCompleted: number) {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ chapters: RESPONSE }) });
		vi.stubGlobal('fetch', fetchSpy);
		const target = document.createElement('div');
		document.body.appendChild(target);
		const props = reactiveProps({
			repertoireId: 'rep-1',
			onselect: vi.fn(),
			onclose: vi.fn(),
			variant: 'inline' as const,
			currentVariationKey: 'v1',
			attemptsCompleted
		});
		const app = mount(VariationPicker, { target, props });
		flushSync();
		return { app, props, fetchSpy, target };
	}

	it('re-fetches when an attempt completes even though the active line has not moved', async () => {
		const { app, props, fetchSpy } = mountPicker(0);
		await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

		// The active line deliberately does NOT move. Mastered moves are credited
		// across every unit sharing them, so an attempt on the active unit can
		// finish a SIBLING unit outright — dropping it from the response — while
		// the active unit is still being served. #175's `currentVariationKey`
		// dependency alone never fires for that, leaving a row whose click
		// `select-variation` can only answer with its 409 "already learned" guard.
		props.attemptsCompleted = 1;
		flushSync();
		await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

		unmount(app);
	});

	it('does not re-fetch when neither the active line nor the attempt count changes', async () => {
		const { app, props, fetchSpy } = mountPicker(3);
		await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

		props.attemptsCompleted = 3;
		props.currentVariationKey = 'v1';
		flushSync();
		await Promise.resolve();
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		unmount(app);
	});
});
