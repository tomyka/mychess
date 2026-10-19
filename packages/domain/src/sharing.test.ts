import { describe, expect, it } from 'vitest';
import { ACCESS_REFUSALS, type CoachAccessFacts } from './coach-access';
import { COMMENT_MAX } from './repertoire';
import {
  COACH_NOTE_ISSUES,
  COACH_NOTE_MAX,
  COACH_NOTE_REFUSALS,
  SHARE_REFUSALS,
  canShare,
  canWriteCoachNote,
  coachNoteSchema,
} from './sharing';

const ok = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });

describe('the sharing keys and limits', () => {
  it('are message-catalogue keys', () => {
    expect(SHARE_REFUSALS).toStrictEqual({
      notOwner: 'share.notOwner',
      notLinked: 'share.notLinked',
    });
    expect(COACH_NOTE_ISSUES).toStrictEqual({
      blank: 'coachNote.blank',
      tooLong: 'coachNote.tooLong',
    });
    expect(COACH_NOTE_REFUSALS).toStrictEqual({
      moveNotFound: 'coachNote.moveNotFound',
    });
  });

  it('caps a coach note like a move comment', () => {
    expect(COACH_NOTE_MAX).toBe(COMMENT_MAX);
  });
});

describe('canShare (R-42)', () => {
  it('lets the owner share an own repertoire with a linked coach', () => {
    expect(canShare('gabija', { ownerId: 'gabija' }, 'rimantas', true)).toEqual(
      ok,
    );
  });

  it("refuses someone else's repertoire, even with a linked coach", () => {
    expect(canShare('gabija', { ownerId: 'rokas' }, 'rimantas', true)).toEqual(
      refused(SHARE_REFUSALS.notOwner),
    );
  });

  it('refuses a coach who is not linked', () => {
    expect(canShare('gabija', { ownerId: 'gabija' }, 'dovydas', false)).toEqual(
      refused(SHARE_REFUSALS.notLinked),
    );
  });

  it('refuses sharing with oneself', () => {
    expect(canShare('gabija', { ownerId: 'gabija' }, 'gabija', true)).toEqual(
      refused(SHARE_REFUSALS.notLinked),
    );
  });
});

describe('coachNoteSchema', () => {
  it('trims and takes up to the limit', () => {
    expect(
      coachNoteSchema.parse(` ${'a'.repeat(COACH_NOTE_MAX)} `),
    ).toHaveLength(COACH_NOTE_MAX);
    expect(coachNoteSchema.parse('  Žiūrėk į e5\n')).toBe('Žiūrėk į e5');
  });

  it.each([
    ['empty', '', COACH_NOTE_ISSUES.blank],
    ['blank', '  ', COACH_NOTE_ISSUES.blank],
    ['too long', 'a'.repeat(COACH_NOTE_MAX + 1), COACH_NOTE_ISSUES.tooLong],
  ])('refuses %s', (_, raw, issue) => {
    expect(coachNoteSchema.safeParse(raw).error?.issues[0]?.message).toBe(
      issue,
    );
  });
});

describe('canWriteCoachNote (R-42)', () => {
  const shared: CoachAccessFacts = {
    linked: true,
    sharedRepertoireIds: new Set(['taimanov']),
  };
  const note = (repertoireId: string) => ({
    coachId: 'rimantas',
    playerId: 'gabija',
    repertoireId,
  });

  it('lets a linked coach note a move of a repertoire shared with them', () => {
    expect(canWriteCoachNote(note('taimanov'), shared, true)).toEqual(ok);
  });

  it('refuses a repertoire not shared with the coach', () => {
    expect(canWriteCoachNote(note('london'), shared, true)).toEqual(
      refused(ACCESS_REFUSALS.notShared),
    );
  });

  it('refuses a coach who is not linked, whatever is shared', () => {
    expect(
      canWriteCoachNote(note('taimanov'), { ...shared, linked: false }, true),
    ).toEqual(refused(ACCESS_REFUSALS.notLinked));
  });

  it('refuses a coach writing on their own repertoire as if shared', () => {
    expect(
      canWriteCoachNote(
        { ...note('taimanov'), playerId: 'rimantas' },
        shared,
        true,
      ),
    ).toEqual(refused(ACCESS_REFUSALS.notLinked));
  });

  it('refuses a move that is not in the repertoire', () => {
    expect(canWriteCoachNote(note('taimanov'), shared, false)).toEqual(
      refused(COACH_NOTE_REFUSALS.moveNotFound),
    );
  });

  it('decides access before the move, so a missing move reveals nothing', () => {
    expect(canWriteCoachNote(note('london'), shared, false)).toEqual(
      refused(ACCESS_REFUSALS.notShared),
    );
  });
});
