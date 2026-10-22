import { describe, expect, it } from 'vitest';
import { refusalCode, refusalError } from './auth-refusal';

const answerOf = (error: ReturnType<typeof refusalError>) => ({
  status: error.statusCode,
  code: error.body?.code,
  message: error.body?.message,
});

describe('refusalError', () => {
  it.each([
    ['signIn.lichessEmailInUse', 400, 'lichess_email_in_use'],
    ['signIn.joinRefused', 400, 'join_refused'],
    ['signIn.sessionNotFresh', 403, 'SESSION_NOT_FRESH'],
    ['signIn.accountDisabled', 401, 'unable_to_create_session'],
  ] as const)(
    'answers %s with status %i and code %j as its message',
    (reason, status, code) => {
      expect(answerOf(refusalError({ reason }))).toEqual({
        status,
        code,
        message: code,
      });
    },
  );

  it('names the client-chosen OAuth field as the message (item 7)', () => {
    expect(
      answerOf(
        refusalError({ reason: 'signIn.clientOAuthField', field: 'loginHint' }),
      ),
    ).toEqual({
      status: 400,
      code: 'unsupported_oauth_field',
      message: 'loginHint',
    });
  });

  it('answers an invalid email with its reason as code and message (item 6)', () => {
    expect(answerOf(refusalError({ reason: 'account.emailInvalid' }))).toEqual({
      status: 400,
      code: 'account.emailInvalid',
      message: 'account.emailInvalid',
    });
  });
});

describe('refusalCode', () => {
  it.each([
    ['signIn.lichessEmailInUse', 'lichess_email_in_use'],
    ['signIn.joinRefused', 'join_refused'],
    ['signIn.sessionNotFresh', 'SESSION_NOT_FRESH'],
    ['signIn.accountDisabled', 'unable_to_create_session'],
  ] as const)('gives %s the code %j', (reason, code) => {
    expect(refusalCode({ reason })).toBe(code);
  });

  it('gives a client-chosen OAuth field its code', () => {
    expect(
      refusalCode({ reason: 'signIn.clientOAuthField', field: 'scopes' }),
    ).toBe('unsupported_oauth_field');
  });
});
