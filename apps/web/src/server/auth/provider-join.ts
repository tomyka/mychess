import { findAccountById, type Db } from '@mychess/db';
import {
  decideProviderJoin,
  LICHESS,
  type ProviderJoin,
} from '@mychess/domain';
import type { BetterAuthOptions } from 'better-auth';
import { revokeUnprovenAccountAccess } from 'better-auth/db';
import { getAuthoritativeSessionFromCtx, getOAuthState } from 'better-auth/api';
import { refusalCode } from '../auth-refusal';
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
 * The domain's answer to a join, denied unless allowed (A1). A verified
 * Google email proves the mailbox, as a magic link does (R-87): if the
 * account is unproven (a Lichess sign-up under the address), Better Auth's
 * own magic-link clean-up ends the access it gathered before the proof
 * (provider links and sessions) and marks the email verified, so Google
 * joins an account the mailbox owner alone holds. The clean-up re-reads the
 * account under its own lock, so it runs for every allowed proof.
 */
async function answerJoin(
  join: ProviderJoin,
  ctx: HookContext,
): Promise<UserInfoAnswer> {
  const decision = decideProviderJoin(join);
  if (!decision.ok) return { error: refusalCode(decision.refusal) };
  if (decision.value.kind === 'proveEmail')
    await revokeUnprovenAccountAccess(ctx, decision.value.accountId);
  return undefined;
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
    return answerJoin(join, ctx);
  };
}
