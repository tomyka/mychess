export type ExistingRelationship = { status: 'pending' | 'active'; requested_by: string } | null;

export type RequestOutcome = { ok: true } | { ok: false; error: string };

/**
 * Decides whether `requesterId` may send a new coach<->player request, given
 * any existing relationship row between the two parties (or null if none).
 * Pure and framework-agnostic so it's trivially testable without mocking
 * Supabase — the IO layer in $lib/server/coach-players.ts calls this before
 * inserting.
 */
export function planRequest(existing: ExistingRelationship, requesterId: string): RequestOutcome {
	if (!existing) return { ok: true };
	if (existing.status === 'active') {
		return { ok: false, error: 'You already have an active relationship.' };
	}
	if (existing.requested_by === requesterId) {
		return { ok: false, error: 'You already sent a request — waiting for a response.' };
	}
	return {
		ok: false,
		error: 'There is already a pending request between you — respond to it instead.'
	};
}
