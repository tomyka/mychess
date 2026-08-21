// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import GamesList from './+page.svelte';

afterEach(() => cleanup());

describe('My Games list', () => {
	it('shows an empty state when there are no games', () => {
		render(GamesList, { props: { data: { games: [] } } });
		expect(screen.getByText(/No games uploaded yet/)).toBeTruthy();
	});

	it('lists an uploaded game with its players and result', () => {
		const games = [
			{
				id: 'g1',
				headers: { White: 'Alice', Black: 'Bob', Result: '1-0', Date: '2026.01.01' },
				analysis_status: 'done',
				analysis: []
			}
		];
		render(GamesList, { props: { data: { games } } });
		expect(screen.getByText(/Alice/)).toBeTruthy();
		expect(screen.getByText(/Bob/)).toBeTruthy();
	});

	it('shows "Not yet analyzed" for a pending game', () => {
		const games = [
			{ id: 'g1', headers: { White: 'Alice', Black: 'Bob' }, analysis_status: 'pending', analysis: null }
		];
		render(GamesList, { props: { data: { games } } });
		expect(screen.getByText(/Not yet analyzed/)).toBeTruthy();
	});

	it('shows blunder/mistake/inaccuracy counts for an analyzed game', () => {
		const games = [
			{
				id: 'g1',
				headers: { White: 'Alice', Black: 'Bob' },
				analysis_status: 'done',
				analysis: [{ classification: 'blunder' }, { classification: 'mistake' }, { classification: null }]
			}
		];
		render(GamesList, { props: { data: { games } } });
		expect(screen.getByText(/1 blunders, 1 mistakes, 0 inaccuracies/)).toBeTruthy();
	});

	it('links each game to its analysis page and includes a delete form', () => {
		const games = [
			{ id: 'g1', headers: { White: 'Alice', Black: 'Bob' }, analysis_status: 'done', analysis: [] }
		];
		render(GamesList, { props: { data: { games } } });
		const link = screen.getByText(/Alice/).closest('a') as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('/games/g1');
		const form = document.querySelector('form[action="?/delete"]') as HTMLFormElement;
		expect((form.querySelector('input[name="game_id"]') as HTMLInputElement).value).toBe('g1');
	});
});
