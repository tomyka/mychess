// mychess/src/test-setup.ts
// Extends vitest's `expect` with jest-dom matchers (toHaveTextContent, etc.)
// for component tests rendered under the jsdom environment. Importing the
// `/vitest` entrypoint auto-registers the matchers; harmless to load in the
// node environment too, since nothing there calls a DOM matcher.
import '@testing-library/jest-dom/vitest';

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

// jsdom doesn't implement window.matchMedia, which src/lib/theme.svelte.ts
// (applyResolvedThemeClass) and the root layout's system-preference $effect
// both call — any test that triggers either throws "matchMedia is not a
// function" without this. A harmless default ('matches: false') is enough
// for anything that just needs the call to not throw; a test asserting
// specific OS-preference behavior can still override it locally with its
// own vi.stubGlobal('matchMedia', ...). No-op in the node environment,
// where nothing ever calls it.
if (typeof globalThis.matchMedia === 'undefined') {
	globalThis.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {}
	})) as unknown as typeof globalThis.matchMedia;
}
