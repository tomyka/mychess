// mychess/src/hooks.client.ts
import type { HandleClientError } from '@sveltejs/kit';
import { recoverFromStaleChunk } from '$lib/staleChunk';

/**
 * Turns "a route chunk from the previous deploy is gone" into a single silent
 * reload instead of an error page. See `$lib/staleChunk` for why this is needed
 * on top of `kit.version.pollInterval`, and for the once-per-session bound.
 *
 * Everything else passes through unchanged: logged for the browser console and
 * reported with the message the error page already shows, since there is
 * nothing more actionable to say about an arbitrary client-side failure.
 */
export const handleError: HandleClientError = ({ error, message }) => {
	if (recoverFromStaleChunk(error)) {
		// This page is being replaced — the message only exists for the frame or
		// two before the reload takes effect.
		return { message: 'Updating to the latest version…' };
	}

	console.error(error);
	return { message };
};
