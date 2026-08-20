// mychess/src/lib/moveLog.ts
//
// Fire-and-forget per-move logging, shared by Learn and the Practice pool.
// These rows are what the weakest-first ordering reads (`move_attempts`), so
// both surfaces must write them identically — they had separate copies of this
// function until epic #95's refactor pass.

/**
 * Records one resolved move. Deliberately swallows failures: a lost log row
 * costs a little ordering accuracy, and must never interrupt the player mid-line.
 */
export function logMove(
	repertoireId: string | undefined,
	moveId: string,
	playedSan: string,
	isCorrect: boolean
): void {
	if (!repertoireId) return;
	fetch('/api/practice/move-log', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ repertoireId, moveId, playedSan, isCorrect })
	}).catch(() => {});
}
