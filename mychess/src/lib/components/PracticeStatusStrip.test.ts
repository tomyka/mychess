// @vitest-environment jsdom
// mychess/src/lib/components/PracticeStatusStrip.test.ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
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
});
