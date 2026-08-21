// @vitest-environment jsdom
// mychess/src/lib/components/RepertoireUpdatedBanner.test.ts
import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/svelte';
import RepertoireUpdatedBanner from './RepertoireUpdatedBanner.svelte';

// Asserts on the singular/plural boundary and on rendering nothing at 0 — NOT
// on the exact wording, which is expected to be iterated. Every query is scoped
// to its own `container`: this project has no auto-cleanup between renders, so
// `screen` would also see the banners rendered by earlier cases in this file.
describe('RepertoireUpdatedBanner', () => {
	it('renders nothing at all when no lines need review', () => {
		const { container } = render(RepertoireUpdatedBanner, { props: { lineCount: 0 } });
		expect(container.textContent?.trim()).toBe('');
		expect(within(container).queryByRole('button')).toBeNull();
	});

	// Collapsed: the source wraps the interpolation onto its own line, so the
	// rendered text carries the template's indentation as real whitespace.
	const text = (container: HTMLElement) => container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

	it('uses the singular form for exactly one line', () => {
		const { container } = render(RepertoireUpdatedBanner, { props: { lineCount: 1 } });
		expect(text(container)).toMatch(/\b1 line needs review\b/);
	});

	it('uses the plural form for more than one line', () => {
		const { container } = render(RepertoireUpdatedBanner, { props: { lineCount: 2 } });
		expect(text(container)).toMatch(/\b2 lines need review\b/);
	});

	it('offers a labelled dismiss button that removes the notice', async () => {
		const { container } = render(RepertoireUpdatedBanner, { props: { lineCount: 3 } });
		const dismiss = within(container).getByRole('button', { name: /dismiss/i });
		dismiss.click();
		// Svelte 5 flushes to the DOM on the microtask queue.
		await Promise.resolve();
		expect(container.textContent?.trim()).toBe('');
	});
});
