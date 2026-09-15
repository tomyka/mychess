// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import ChessBoard from './ChessBoard.svelte';

afterEach(() => cleanup());

// Chessground renders its own shapes into a `<svg class="cg-shapes">` overlay
// that it injects into the DOM itself (not something Svelte/testing-library
// renders from a template), tagging each shape's `<g>` wrapper with a
// `cgHash` attribute encoding "orig,dest,brush" — confirmed by inspecting the
// real rendered output rather than assumed. Asserting on that attribute
// checks that arrowShapes()'s output actually reached chessground's
// `drawable.autoShapes` config (buildConfig()'s `[...arrowShapes(), ...feedbackShapes()]`
// merge), without depending on chessground's internal line/marker geometry
// (which reads as NaN here anyway, since jsdom never lays out `cg-container`
// to a real pixel size).
describe('ChessBoard', () => {
	it('renders a chessground arrow shape for arrowMove', () => {
		const { container } = render(ChessBoard, {
			props: { arrowMove: { from: 'e2', to: 'e4' } }
		});
		const arrow = container.querySelector('svg.cg-shapes g[cgHash]');
		expect(arrow).toBeTruthy();
		expect(arrow?.getAttribute('cgHash')).toBe('e2,e4,yellow');
		expect(arrow?.querySelector('line')).toBeTruthy();
	});

	it('renders no arrow shape when arrowMove is null', () => {
		const { container } = render(ChessBoard, { props: { arrowMove: null } });
		expect(container.querySelector('svg.cg-shapes g[cgHash]')).toBeNull();
	});

	it('renders no arrow shape when arrowMove is omitted (default)', () => {
		const { container } = render(ChessBoard, { props: {} });
		expect(container.querySelector('svg.cg-shapes g[cgHash]')).toBeNull();
	});
});

// GitHub issue #217. Mobile Learn hides the status strip, so the three states
// the board cannot show by itself ride on the board as a floating pill.
describe('the mode note', () => {
	it('renders the note when one is given', () => {
		render(ChessBoard, { props: { note: 'Exploring \u2014 nothing counts here' } });
		expect(screen.getByText('Exploring \u2014 nothing counts here')).toBeTruthy();
	});

	it('renders nothing when there is no note', () => {
		const { container } = render(ChessBoard, { props: {} });
		expect(container.querySelector('[aria-hidden="true"].absolute.inset-x-0')).toBeNull();
	});

	// Not a live region, on purpose. The strip stays mounted as `sr-only` on
	// mobile and remains the single place any of this is announced \u2014 both so the
	// same sentence is not read out twice, and because the strip announces the
	// full set rather than this subset: the red cross this pill replaces is drawn
	// on a square, which is worth nothing to a screen reader.
	it('is decoration, not an announcement', () => {
		const { container } = render(ChessBoard, { props: { note: 'Exploring' } });
		expect(screen.queryByRole('status')).toBeNull();
		const pill = container.querySelector('[aria-hidden="true"].absolute.inset-x-0') as HTMLElement;
		expect(pill).toBeTruthy();
		// Desktop keeps the real strip, so the pill must not double up there.
		expect(pill.className).toContain('lg:hidden');
	});
});
