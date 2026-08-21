import { parsePgn } from '$lib/pgn/parser';

export type GameMove = {
	ply: number;
	san: string;
	fen: string;
	parentFen: string;
};

export type ExtractedGame = {
	headers: Record<string, string>;
	moves: GameMove[];
};

export type ExtractGameResult = { game: ExtractedGame } | { error: string };

/**
 * Pulls exactly one game's mainline out of a PGN string, for the Analysis
 * upload flow — v1 is single-game-only, so this rejects anything that isn't
 * exactly one game rather than picking one for the caller. Variations
 * (RAV) in the source PGN are silently dropped; `parsePgn` already only
 * tracks them as a shared move graph, not a tree, which this flattens back
 * into a single ordered list assuming no branching (true for a real game
 * export, which is what this is for).
 */
export function extractSingleGame(pgnText: string): ExtractGameResult {
	const games = parsePgn(pgnText);
	if (games.length === 0) return { error: 'No valid game found in that PGN.' };
	if (games.length > 1) {
		return { error: `This file contains ${games.length} games — upload one game at a time.` };
	}
	const [game] = games;
	const moves: GameMove[] = game.moves.map((m) => ({
		ply: m.ply,
		san: m.san,
		fen: m.fen,
		parentFen: m.parentFen
	}));
	return { game: { headers: game.headers, moves } };
}
