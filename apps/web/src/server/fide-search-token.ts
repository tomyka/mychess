/**
 * The token a started FIDE ID search hands the page for its progress polls
 * (#316, security requirements of task 4). Only a search start counts
 * against the account's rate limit; a poll presents this token instead, so
 * it can follow the one search that was counted, never look up another ID.
 *
 * It is the searched ID, the months the search covers, the account and an
 * expiry, signed with an HMAC-SHA256 under a key HKDF derives from the server's
 * auth secret. Stateless: it survives a restart and needs no memory per
 * search. It is not secret from its own account (it holds what they typed)
 * and it travels in a POST body, so the ID stays out of URLs and logs.
 */
import {
  BROADCAST_MONTH_RULES,
  broadcastMonthSchema,
  fideIdSchema,
  refuse,
  ok,
  type BroadcastMonth,
  type FideId,
  type Result,
} from '@mychess/domain';
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** How long a search's progress can be polled: an hour. */
export const SEARCH_TOKEN_TTL_MS = 60 * 60_000;

/** Catalogue key of a token that is missing, forged, foreign or expired. */
const SEARCH_EXPIRED = 'fide.searchExpired';

export interface SearchTokenRefusal {
  readonly reason: typeof SEARCH_EXPIRED;
}

/** What a search token names. */
export interface TokenSearch {
  readonly fideId: FideId;
  readonly months: readonly BroadcastMonth[];
}

/** The longest token read; a real one is a few hundred characters. */
const MAX_TOKEN_CHARS = 2048;

/**
 * The HKDF salt and info that derive this use's key from the auth secret,
 * apart from Better Auth's own use of it (security L2).
 */
const KEY_SALT = 'mychess';
const KEY_INFO = 'fide-search-token v1';
const KEY_BYTES = 32;

const payloadSchema = z.object({
  a: z.string().min(1),
  f: fideIdSchema,
  m: z.array(broadcastMonthSchema).max(BROADCAST_MONTH_RULES.searchMonths),
  e: z.number().int(),
});

const tokenSchema = z.string().max(MAX_TOKEN_CHARS);

/** The search `search` of `accountId`, signed at `now` for an hour. */
export function signSearchToken(
  secret: string,
  search: TokenSearch & { readonly accountId: string },
  now: Date,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      a: search.accountId,
      f: search.fideId,
      m: search.months,
      e: now.getTime() + SEARCH_TOKEN_TTL_MS,
    }),
  ).toString('base64url');
  return `${payload}.${mac(secret, payload).toString('base64url')}`;
}

/**
 * The search `raw` names, when it is a token this server signed for
 * `accountId` that has not expired at `now`; refused otherwise.
 */
export function readSearchToken(
  secret: string,
  raw: unknown,
  accountId: string,
  now: Date,
): Result<TokenSearch, SearchTokenRefusal> {
  const payload = verifiedPayload(secret, raw);
  if (payload?.a !== accountId || payload.e <= now.getTime()) {
    return refuse(SEARCH_EXPIRED);
  }
  return ok({ fideId: payload.f, months: payload.m });
}

/** The payload of `raw` when its signature is this server's. */
function verifiedPayload(
  secret: string,
  raw: unknown,
): z.infer<typeof payloadSchema> | undefined {
  const token = tokenSchema.safeParse(raw);
  const parts = token.success ? token.data.split('.') : [];
  const [payload, signature] = parts;
  if (parts.length !== 2 || payload === undefined || signature === undefined) {
    return undefined;
  }
  const given = Buffer.from(signature, 'base64url');
  const expected = mac(secret, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return undefined;
  }
  const parsed = payloadSchema.safeParse(jsonOrUndefined(payload));
  return parsed.success ? parsed.data : undefined;
}

function mac(secret: string, payload: string): Buffer {
  const key = Buffer.from(
    hkdfSync('sha256', secret, KEY_SALT, KEY_INFO, KEY_BYTES),
  );
  return createHmac('sha256', key).update(payload).digest();
}

/** `payload` decoded as JSON; undefined, which the schema refuses, if not. */
function jsonOrUndefined(payload: string): unknown {
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}
