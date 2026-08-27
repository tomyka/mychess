// mychess/src/lib/components/MoveList.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import MoveList from './MoveList.svelte';

afterEach(() => cleanup());

describe('MoveList', () => {
	it('renders the — fallback for an empty array', () => {
		const { getByText, queryByRole } = render(MoveList, { props: { rows: [] } });
		expect(getByText('—')).toBeTruthy();
		expect(queryByRole('grid')).toBeNull();
	});

	it('renders paired move rows', () => {
		const { getByText } = render(MoveList, {
			props: {
				rows: [
					{ number: 1, white: 'e4', black: 'e5' },
					{ number: 2, white: 'Nf3', black: 'Nc6' }
				]
			}
		});
		expect(getByText('1.')).toBeTruthy();
		expect(getByText('e4')).toBeTruthy();
		expect(getByText('e5')).toBeTruthy();
		expect(getByText('2.')).toBeTruthy();
		expect(getByText('Nf3')).toBeTruthy();
		expect(getByText('Nc6')).toBeTruthy();
	});

	it('renders a trailing White-only row with an empty Black cell', () => {
		const { getByText, container } = render(MoveList, {
			props: {
				rows: [{ number: 1, white: 'e4', black: null }]
			}
		});
		expect(getByText('1.')).toBeTruthy();
		expect(getByText('e4')).toBeTruthy();
		const spans = container.querySelectorAll('span.font-mono');
		expect(spans[1].textContent).toBe('');
	});
});
