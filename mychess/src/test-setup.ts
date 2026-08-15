// mychess/src/test-setup.ts
// jsdom doesn't implement ResizeObserver, which Svelte's `bind:clientWidth`/
// `bind:clientHeight` actions use internally — any component test that
// renders one (e.g. ChessBoard, via its `boxWidth` binding) throws
// "ResizeObserver is not defined" without this. Runs for every test file
// (jsdom and node environments alike); a no-op stub is harmless in node,
// where nothing ever constructs one.
if (typeof globalThis.ResizeObserver === 'undefined') {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}
