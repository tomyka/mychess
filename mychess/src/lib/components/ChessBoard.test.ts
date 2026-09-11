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

// GitHub issue #217. Mobile Learn has no status strip, so the three states the
// board cannot show by itself ride on the board as a floating pill.
describe('the mode note', () => {
	it('renders the note when one is given', () => {
		render(ChessBoard, { props: { note: 'Exploring \u2014 nothing counts here' } });
		expect(screen.getByText('Exploring \u2014 nothing counts here')).toBeTruthy();
	});

	// Mounting a live region at the same instant its text appears is the classic
	// way to get no announcement at all, so the region is permanent and only its
	// contents change. It costs no layout either way \u2014 it is absolutely
	// positioned \u2014 so there is no reason to unmount it.
	it('keeps an empty live region mounted when there is no note', () => {
		render(ChessBoard, { props: {} });
		const region = screen.getByRole('status');
		expect(region).toBeTruthy();
		expect(region.textContent?.trim()).toBe('');
	});

	// Desktop keeps PracticeStatusStrip, which is itself a role="status" region.
	// Without this the same sentence would be announced twice there.
	it('hides the region from desktop, where the strip still speaks', () => {
		render(ChessBoard, { props: { note: 'Exploring' } });
		expect(screen.getByRole('status').className).toContain('lg:hidden');
	});
});
