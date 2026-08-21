// @vitest-environment jsdom
// mychess/src/lib/components/EngineToggle.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import EngineToggle from './EngineToggle.svelte';
import { engineEnabled } from '$lib/engine/engine.svelte';

afterEach(() => {
	cleanup();
	engineEnabled.on = false;
});

describe('EngineToggle', () => {
	it('starts off, and says so to assistive tech', () => {
		render(EngineToggle);
		const button = screen.getByRole('button', { name: /engine/i });
		expect(button.getAttribute('aria-pressed')).toBe('false');
		expect(engineEnabled.on).toBe(false);
	});

	it('switches the engine on when pressed, and off again when pressed twice', async () => {
		render(EngineToggle);
		const button = screen.getByRole('button', { name: /engine/i });

		await fireEvent.click(button);
		expect(engineEnabled.on).toBe(true);
		expect(button.getAttribute('aria-pressed')).toBe('true');

		await fireEvent.click(button);
		expect(engineEnabled.on).toBe(false);
		expect(button.getAttribute('aria-pressed')).toBe('false');
	});

	it('reflects the engine being switched on from somewhere else', async () => {
		const { rerender } = render(EngineToggle);
		engineEnabled.on = true;
		await rerender({});
		expect(screen.getByRole('button', { name: /engine/i }).getAttribute('aria-pressed')).toBe('true');
	});
});
