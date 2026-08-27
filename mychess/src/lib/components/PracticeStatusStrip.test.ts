// @vitest-environment jsdom
// mychess/src/lib/components/PracticeStatusStrip.test.ts
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import PracticeStatusStrip from './PracticeStatusStrip.svelte';

describe('PracticeStatusStrip', () => {
	it('renders an empty status region when silent (a teaching arrow is up)', () => {
		render(PracticeStatusStrip, { props: { state: 'silent' } });
		expect(screen.getByRole('status').textContent?.trim()).toBe('');
	});

	it('shows the wrong-move message', () => {
		render(PracticeStatusStrip, { props: { state: 'wrong' } });
		expect(screen.getByText(/Not that move/i)).toBeTruthy();
	});

	it('shows the correct-move message', () => {
		render(PracticeStatusStrip, { props: { state: 'correct' } });
		expect(screen.getByText(/^Correct$/i)).toBeTruthy();
	});

	it('shows the blind-retest prompt', () => {
		render(PracticeStatusStrip, { props: { state: 'blind' } });
		expect(screen.getByText('Play it from memory')).toBeTruthy();
	});

	it('shows the autoplay-intro message', () => {
		render(PracticeStatusStrip, { props: { state: 'autoplay' } });
		expect(screen.getByText(/Replaying what you already know/i)).toBeTruthy();
	});

	it('shows the retest cue', () => {
		render(PracticeStatusStrip, { props: { state: 'retest-cue' } });
		expect(screen.getByText(/now play it from memory/i)).toBeTruthy();
	});

	// #113: the strip stacks straight onto the board at every width, so the
	// hint offer shares its one fixed-height slot instead of adding a row that
	// mounts and unmounts under the player's finger. These scope their queries
	// to their own `container` — this project has no auto-cleanup between
	// renders, so `screen` sees every strip rendered earlier in the file, and
	// the copy asserted on here is copy other cases render too.
	it('hands the slot to the hint offer during the blind retest', () => {
		const { container } = render(PracticeStatusStrip, {
			props: { state: 'blind', onhint: () => {} }
		});
		const strip = within(container);
		expect(strip.getByRole('button', { name: /Need a hint/i })).toBeTruthy();
		// The two are mutually exclusive now that there's no separate desktop
		// hint button to keep them apart for.
		expect(strip.queryByText('Play it from memory')).toBeNull();
	});

	it('keeps move feedback in the slot even when a hint is on offer', () => {
		const { container } = render(PracticeStatusStrip, {
			props: { state: 'wrong', onhint: () => {} }
		});
		const strip = within(container);
		expect(strip.queryByRole('button', { name: /Need a hint/i })).toBeNull();
		expect(strip.getByText(/Not that move/i).className).toBe('');
	});

	it('offers no hint under a teaching arrow — the move is already on the board', () => {
		const { container } = render(PracticeStatusStrip, {
			props: { state: 'silent', onhint: () => {} }
		});
		expect(within(container).queryByRole('button', { name: /Need a hint/i })).toBeNull();
	});

	it('offers no hint without a callback, whatever the state', () => {
		const { container } = render(PracticeStatusStrip, { props: { state: 'blind' } });
		expect(within(container).queryByRole('button', { name: /Need a hint/i })).toBeNull();
	});

	it('passes hintTitle through as the hint button title, for a caller with extra context to give', () => {
		const { container } = render(PracticeStatusStrip, {
			props: { state: 'blind', onhint: () => {}, hintTitle: 'Demotes this line back to Learn' }
		});
		expect(within(container).getByRole('button', { name: /Need a hint/i }).title).toBe(
			'Demotes this line back to Learn'
		);
	});
});
