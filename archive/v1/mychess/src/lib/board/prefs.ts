export type BoardTheme = 'brown' | 'green' | 'blue' | 'midnight';
export type PieceSet = 'cburnett' | 'merida' | 'alpha';
export type AnimationSpeed = 'off' | 'subtle' | 'snappy';

export interface BoardPrefs {
	theme: BoardTheme;
	pieceSet: PieceSet;
	animation: AnimationSpeed;
	coordinates: boolean;
	highlight: boolean;
}

export const BOARD_THEMES: { id: BoardTheme; label: string; light: string; dark: string }[] = [
	{ id: 'brown', label: 'Brown', light: '#f0d9b5', dark: '#b58863' },
	{ id: 'green', label: 'Green', light: '#ebecd0', dark: '#779556' },
	{ id: 'blue', label: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
	{ id: 'midnight', label: 'Midnight', light: '#6b7a8f', dark: '#3b4657' }
];

export const PIECE_SETS: { id: PieceSet; label: string }[] = [
	{ id: 'cburnett', label: 'Cburnett' },
	{ id: 'merida', label: 'Merida' },
	{ id: 'alpha', label: 'Alpha' }
];

export const ANIMATION_SPEEDS: { id: AnimationSpeed; label: string; durationMs: number }[] = [
	{ id: 'off', label: 'Off', durationMs: 0 },
	{ id: 'subtle', label: 'Subtle', durationMs: 200 },
	{ id: 'snappy', label: 'Snappy', durationMs: 120 }
];

export const DEFAULT_PREFS: BoardPrefs = {
	theme: 'brown',
	pieceSet: 'cburnett',
	animation: 'subtle',
	coordinates: true,
	highlight: true
};

function pick<T extends string>(val: unknown, allowed: readonly T[], fallback: T): T {
	return typeof val === 'string' && (allowed as readonly string[]).includes(val)
		? (val as T)
		: fallback;
}

function bool(val: unknown, fallback: boolean): boolean {
	return typeof val === 'boolean' ? val : fallback;
}

export function parseBoardPrefs(raw: unknown): BoardPrefs {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_PREFS };
	const r = raw as Record<string, unknown>;
	return {
		theme: pick(r.theme, BOARD_THEMES.map((t) => t.id), DEFAULT_PREFS.theme),
		pieceSet: pick(r.pieceSet, PIECE_SETS.map((p) => p.id), DEFAULT_PREFS.pieceSet),
		animation: pick(r.animation, ANIMATION_SPEEDS.map((a) => a.id), DEFAULT_PREFS.animation),
		coordinates: bool(r.coordinates, DEFAULT_PREFS.coordinates),
		highlight: bool(r.highlight, DEFAULT_PREFS.highlight)
	};
}

export function animationDuration(speed: AnimationSpeed): number {
	return ANIMATION_SPEEDS.find((a) => a.id === speed)?.durationMs ?? 0;
}
