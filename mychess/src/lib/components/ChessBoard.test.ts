// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
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
