import { describe, expect, it } from 'vitest';
import {
  LICHESS_TOKEN_INVALID,
  lichessTokenSchema,
} from './lichess-broadcast-request';

describe('lichessTokenSchema', () => {
  it.each(['lip_SyntheticToken123', 'a', 'A_1', 'x'.repeat(256)])(
    'accepts %j',
    (token) => {
      expect(lichessTokenSchema.safeParse(token)).toEqual({
        success: true,
        data: token,
      });
    },
  );

  it('refuses an empty token with the catalogue key', () => {
    expect(
      lichessTokenSchema.safeParse('').error?.issues.map((i) => i.message),
    ).toEqual([LICHESS_TOKEN_INVALID]);
  });

  it.each([
    ['over 256 characters', 'x'.repeat(257)],
    ['with a space', 'lip_with space'],
    ['with a line break (header injection)', 'lip_x\r\nX-Evil: 1'],
    ['with a non-ASCII letter', 'lip_é'],
    ['with a hyphen', 'lip-abc'],
  ])(
    'refuses a token %s, with the catalogue key and without the value',
    (_, token) => {
      const parsed = lichessTokenSchema.safeParse(token);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
        LICHESS_TOKEN_INVALID,
      ]);
      expect(JSON.stringify(parsed.error)).not.toContain(token);
    },
  );

  it.each([undefined, null, 42])('refuses %j, which is no text', (value) => {
    const parsed = lichessTokenSchema.safeParse(value);
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
      LICHESS_TOKEN_INVALID,
    ]);
  });

  it('uses a message-catalogue key', () => {
    expect(LICHESS_TOKEN_INVALID).toBe('lichessBroadcast.tokenInvalid');
  });
});
