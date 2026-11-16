import { countRateLimited, type Db } from '@mychess/db';
import {
  canLinkProvider,
  canStartOAuth,
  MAGIC_LINK_EMAIL_RATE_LIMIT,
  magicLinkEmailRateKey,
  magicLinkRequest,
} from '@mychess/domain';
import { getAuthoritativeSessionFromCtx } from 'better-auth/api';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { rateRefusalError, refusalError } from '../auth-refusal';

const requestBody = z.looseObject({ email: z.unknown() });

interface HookRequest {
  readonly path?: string | undefined;
  readonly body?: unknown;
}

type HookAnswer = { context: { body: Record<string, unknown> } } | undefined;

/**
 * The magic-link request with its email canonical, so the verification
 * token records the one form the account is keyed by, and with no name:
 * only Google or Lichess prefill the display name (R-81). Better Auth merges
 * this body into the request's, so the name is blanked rather than dropped
 * (an absent key would keep the client's value).
 */
function canonicalMagicLinkBody(raw: unknown) {
  const parsed = requestBody.safeParse(raw);
  const body = parsed.success ? parsed.data : { email: undefined };
  const request = magicLinkRequest(body.email);
  if (!request.ok) throw refusalError(request.refusal);
  return { ...body, ...request.value };
}

/** A one-way hash, so the counter table never holds an address (#264). */
const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

/**
 * Counts a link to `email` against its inbox's limit, whether or not an
 * account has it, so neither the count nor the refusal tells whether one
 * exists (#264).
 */
async function refuseFloodedInbox(db: Db, email: string): Promise<void> {
  const counted = await countRateLimited(
    db,
    magicLinkEmailRateKey(email, sha256),
    MAGIC_LINK_EMAIL_RATE_LIMIT,
    new Date(),
  );
  if (!counted.ok) throw rateRefusalError(counted.refusal);
}

/**
 * A magic-link request made canonical, then counted against its inbox
 * before anything is mailed.
 */
async function countedMagicLinkBody(
  db: Db,
  ctx: HookRequest,
): Promise<HookAnswer> {
  if (ctx.path !== '/sign-in/magic-link') return undefined;
  const body = canonicalMagicLinkBody(ctx.body);
  await refuseFloodedInbox(db, body.email);
  return { context: { body } };
}

const OAUTH_START_PATHS = new Set(['/sign-in/social', '/link-social']);

/** The fields a request body names; none when it is not an object. */
const fieldsOf = (body: unknown): string[] => {
  const parsed = z.looseObject({}).safeParse(body);
  return parsed.success ? Object.keys(parsed.data) : [];
};

/**
 * Refuses an OAuth start that names its own scopes, provider parameters,
 * login hint or id token. Better Auth merges a hook's body into the
 * request's, so the fields cannot be dropped, only refused.
 */
function refuseClientOAuthFields(ctx: HookRequest): void {
  if (ctx.path === undefined || !OAUTH_START_PATHS.has(ctx.path)) return;
  const start = canStartOAuth(fieldsOf(ctx.body));
  if (!start.ok) throw refusalError(start.refusal);
}

export type HookContext = Parameters<typeof getAuthoritativeSessionFromCtx>[0];

const LINK_PATH = '/link-social';

/**
 * Linking a provider needs a fresh session, as unlinking does, so a stolen
 * old session cannot attach the thief's Google or Lichess as a way in. The
 * same code as unlink's, so settings shows the same message. A request with
 * no session is left to Better Auth, which refuses it.
 */
async function refuseStaleLink(ctx: HookContext): Promise<void> {
  if (ctx.path !== LINK_PATH) return;
  const current = await getAuthoritativeSessionFromCtx(ctx);
  if (current === null) return;
  const link = canLinkProvider(new Date(current.session.createdAt), new Date());
  if (!link.ok) throw refusalError(link.refusal);
}

/**
 * Every request, before Better Auth handles it and after Better Auth's own
 * per-client-address limits.
 */
export function beforeRequest(db: Db) {
  return async (ctx: HookContext): Promise<HookAnswer> => {
    refuseClientOAuthFields(ctx);
    await refuseStaleLink(ctx);
    return countedMagicLinkBody(db, ctx);
  };
}
