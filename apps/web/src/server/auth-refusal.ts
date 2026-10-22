import type {
  AccountRefusal,
  RateRefusal,
  SignInRefusal,
  SignInRefusalReason,
} from '@mychess/domain';
import { APIError } from 'better-auth/api';
import {
  JOIN_REFUSED,
  LICHESS_EMAIL_IN_USE,
  SESSION_NOT_FRESH,
  SESSION_REFUSED,
  UNSUPPORTED_OAUTH_FIELD,
} from '../lib/sign-in-errors';

interface WireAnswer {
  readonly status: 'BAD_REQUEST' | 'FORBIDDEN' | 'UNAUTHORIZED';
  readonly code: string;
}

/**
 * The wire answer of every sign-in refusal the domain gives, the codes the
 * sign-in page, settings and the export route already translate
 * (`lib/sign-in-errors.ts`). Total by type: a new reason fails typecheck
 * until it has an answer. The two join rows answer `validateUserInfo`'s
 * `{ error }` (Better Auth picks the redirect, so their status is unused);
 * the disabled row is Better Auth's own answer to the session hook's `false`.
 */
const ANSWERS: Record<SignInRefusalReason, WireAnswer> = {
  'signIn.lichessEmailInUse': {
    status: 'BAD_REQUEST',
    code: LICHESS_EMAIL_IN_USE,
  },
  'signIn.joinRefused': { status: 'BAD_REQUEST', code: JOIN_REFUSED },
  'signIn.sessionNotFresh': { status: 'FORBIDDEN', code: SESSION_NOT_FRESH },
  'signIn.clientOAuthField': {
    status: 'BAD_REQUEST',
    code: UNSUPPORTED_OAUTH_FIELD,
  },
  // Documentation only: the session hook returns false and Better Auth
  // itself answers with this status and code; no refusalError is built here.
  'signIn.accountDisabled': {
    status: 'UNAUTHORIZED',
    code: SESSION_REFUSED,
  },
};

const isSignInReason = (reason: string): reason is SignInRefusalReason =>
  Object.hasOwn(ANSWERS, reason);

/** The message: the client-chosen field it names, else the code itself. */
const messageOf = (refusal: SignInRefusal | AccountRefusal, code: string) =>
  refusal.reason === 'signIn.clientOAuthField' ? refusal.field : code;

/**
 * A refusal as the error a request hook throws. An invalid email answers
 * with its catalogue key as code and message (security item 6).
 */
export function refusalError(
  refusal: SignInRefusal | AccountRefusal,
): APIError {
  const { reason } = refusal;
  const { status, code } = isSignInReason(reason)
    ? ANSWERS[reason]
    : { status: 'BAD_REQUEST' as const, code: reason };
  return new APIError(status, { code, message: messageOf(refusal, code) });
}

/**
 * A request over one of our own limits as the error a request hook throws:
 * 429, as Better Auth's own limits answer, so the sign-in page shows the
 * same message; the reason is code and message.
 */
export function rateRefusalError(refusal: RateRefusal): APIError {
  const { reason } = refusal;
  return new APIError('TOO_MANY_REQUESTS', { code: reason, message: reason });
}

/** A refused provider join as `validateUserInfo`'s `?error=` code. */
export function refusalCode(refusal: SignInRefusal): string {
  return ANSWERS[refusal.reason].code;
}
