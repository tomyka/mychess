// A provider's getUserInfo is handed tokens only, no endpoint context; the
// proof below needs the callback's own context (its path, the adapter and the
// cookies its account hooks set), which Better Auth exposes only from core.
// Pinned to better-auth's own core version: bump both together.
import {
  tryGetCurrentAuthEndpointContext,
  type AuthEndpointContext,
} from '@better-auth/core/context';
import { findAccountById, type Db } from '@mychess/db';
import {
  decideProviderJoin,
  GOOGLE,
  LICHESS,
  type Account,
  type ProviderJoin,
} from '@mychess/domain';
import type { BetterAuthOptions } from 'better-auth';
import { revokeUnprovenAccountAccess } from 'better-auth/db';
import { getAuthoritativeSessionFromCtx, getOAuthState } from 'better-auth/api';
import { refusalCode } from '../auth-refusal';
import { googleUserInfo, type GoogleUserInfo } from '../oauth/google';
import type { HookContext } from './request-hooks';

type UserOptions = NonNullable<BetterAuthOptions['user']>;
type ValidateUserInfo = NonNullable<UserOptions['validateUserInfo']>;

type UserInfo = Parameters<ValidateUserInfo>[0];
type UserInfoAnswer = Awaited<ReturnType<ValidateUserInfo>>;

/** The account Better Auth is about to link the identity to, if it names one. */
const idOf = (user: UserInfo['user']): string | undefined =>
  typeof user.id === 'string' ? user.id : undefined;

/**
 * A link from settings (`/link-social` put `link` in the OAuth state). The
 * domain lets Lichess join only while signed in to that very account (R-69,
 * R-83); Better Auth itself joins any other provider to the session's
 * account only. The session is read for Lichess alone, the one link the
 * domain checks against it.
 */
async function settingsJoinRequest(
  { user, source }: UserInfo,
  ctx: HookContext,
  linkAccountId: string,
): Promise<ProviderJoin> {
  const provider = source.oauth?.providerId;
  const current =
    provider === LICHESS ? await getAuthoritativeSessionFromCtx(ctx) : null;
  return {
    via: 'settings',
    provider,
    linkAccountId,
    targetAccountId: idOf(user),
    sessionAccountId: current?.user.id,
  };
}

/** A provider joining the account with its email at sign-in. */
async function emailJoinRequest(
  db: Db,
  { user, source }: UserInfo,
): Promise<ProviderJoin> {
  const accountId = idOf(user);
  const account =
    accountId === undefined ? undefined : await findAccountById(db, accountId);
  return {
    via: 'email',
    provider: source.oauth?.providerId,
    emailVerified: user.emailVerified,
    account,
  };
}

/**
 * The domain's answer to a join, denied unless allowed (A1). A proof of
 * the email has already run by now (proveGoogleEmail): Better Auth joins
 * only an account whose email is verified.
 */
function answerJoin(join: ProviderJoin): UserInfoAnswer {
  const decision = decideProviderJoin(join);
  return decision.ok ? undefined : { error: refusalCode(decision.refusal) };
}

/**
 * Every provider identity, before it joins or creates an account. Better
 * Auth calls it before every provider link: the settings link and the
 * implicit link at sign-in by email alike; only the former carries `link`
 * in its OAuth state, so a plain sign-in by a signed-in person is an
 * implicit join too. A new sign-up is `create-user`, not a link, and passes.
 */
export function validateUserInfo(db: Db): ValidateUserInfo {
  return async (data, ctx) => {
    if (data.source.action !== 'link-account') return;
    const link = (await getOAuthState())?.link;
    const join =
      link === undefined
        ? await emailJoinRequest(db, data)
        : await settingsJoinRequest(data, ctx, link.userId);
    return answerJoin(join);
  };
}

// Better Auth's provider callback, the one route where a sign-in proves.
const CALLBACK_PATH = '/callback/:id';

type ProofContext = Parameters<typeof revokeUnprovenAccountAccess>[0];

/**
 * Is this the provider callback's context? Better Auth runs every handler
 * with its full endpoint context (api/dispatch.mjs, runWithEndpointContext);
 * the store only types it as partial.
 */
const isCallback = (
  ctx: AuthEndpointContext,
): ctx is AuthEndpointContext & ProofContext =>
  ctx.path === CALLBACK_PATH && typeof ctx.setCookie === 'function';

/** The provider callback's context, when this request is one. */
function callbackContext(): ProofContext | undefined {
  const ctx = tryGetCurrentAuthEndpointContext();
  return ctx !== undefined && isCallback(ctx) ? ctx : undefined;
}

/**
 * A verified Google email proves the mailbox, as a magic link does (R-87).
 * When the account with that email is unproven (a Lichess sign-up under the
 * address), Better Auth's own magic-link clean-up ends the access it
 * gathered before the proof (provider links and sessions) and marks the
 * email verified, under its own lock, so Google joins an account the
 * mailbox owner alone holds.
 *
 * It runs as Google's identity is read, before Better Auth looks the
 * account up: Better Auth joins only an account whose email is already
 * verified and asks `validateUserInfo` only after that check
 * (oauth2/link-account.mjs, handleOAuthUserInfo). Only a sign-in proves: a
 * link from settings, or a Google identity an account already holds, joins
 * no account by its email.
 */
async function proveGoogleEmail(
  db: Db,
  identity: { readonly sub: string; readonly email: string },
): Promise<void> {
  const ctx = callbackContext();
  if (ctx === undefined) return;
  if ((await getOAuthState())?.link !== undefined) return;
  const key = { providerId: GOOGLE, accountId: identity.sub };
  if ((await ctx.context.internalAdapter.findAccountByKey(key)) !== null)
    return;
  const decision = decideProviderJoin({
    via: 'email',
    provider: GOOGLE,
    emailVerified: true,
    account: await joinTarget(db, ctx, identity.email),
  });
  if (decision.ok && decision.value.kind === 'proveEmail')
    await revokeUnprovenAccountAccess(ctx, decision.value.accountId);
}

/**
 * The account Better Auth's join will find for this email, looked up
 * exactly as it does: the email lowercased, nothing else folded
 * (oauth2/link-account.mjs, findUserByEmail). A Google email that matches
 * an account only once canonicalised proves nothing of that account.
 */
async function joinTarget(
  db: Db,
  ctx: ProofContext,
  email: string,
): Promise<Account | undefined> {
  const found = await ctx.context.internalAdapter.findUserByEmail(
    email.toLowerCase(),
  );
  return found === null ? undefined : findAccountById(db, found.user.id);
}

/** Google's identity, proving its email as it is read (proveGoogleEmail). */
export function provingGoogleUserInfo(db: Db) {
  return async (
    tokens: Parameters<typeof googleUserInfo>[0],
  ): Promise<GoogleUserInfo | null> => {
    const info = await googleUserInfo(tokens);
    if (info !== null)
      await proveGoogleEmail(db, {
        sub: info.data.sub,
        email: info.user.email,
      });
    return info;
  };
}
