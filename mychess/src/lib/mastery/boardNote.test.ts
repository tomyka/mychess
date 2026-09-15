// mychess/src/lib/mastery/boardNote.test.ts
import { describe, it, expect } from 'vitest';
import { boardNoteFor } from './boardNote';
import { baseLocale, overwriteGetLocale } from '$lib/paraglide/runtime';

describe('boardNoteFor', () => {
	it('speaks for the three states the board cannot show itself', () => {
		expect(boardNoteFor('exploring')).toMatch(/Exploring/i);
		expect(boardNoteFor('retest-cue')).toMatch(/from memory/i);
		expect(boardNoteFor('autoplay')).toMatch(/Replaying/i);
	});

	// These are the states the strip was duplicating: ChessBoard already draws a
	// cross on a rejected square and a check on an accepted one, and 'blind' is
	// an interactive board on your own turn.
	it('stays quiet where the board already says it', () => {
		expect(boardNoteFor('wrong')).toBeNull();
		expect(boardNoteFor('correct')).toBeNull();
		expect(boardNoteFor('blind')).toBeNull();
		expect(boardNoteFor('silent')).toBeNull();
	});

	// Resolved per call, not captured at module load — otherwise the pill would
	// hold whatever locale happened to be active when the module was first
	// imported.
	it('resolves its copy in the locale in force at call time', () => {
		const english = boardNoteFor('exploring');
		overwriteGetLocale(() => 'lt');
		try {
			const lithuanian = boardNoteFor('exploring');
			expect(lithuanian).toBeTruthy();
			expect(lithuanian).not.toBe(english);
		} finally {
			overwriteGetLocale(() => baseLocale);
		}
	});
});
