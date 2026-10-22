import { previewInvite } from '@mychess/db';
import {
  INVITE_REFUSALS,
  accountStage,
  inviteTokenSchema,
} from '@mychess/domain';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { onboardingPath, signInPath } from '../../../lib/return-path';
import { invitePath } from '../../../lib/routes';
import { getDb } from '../../../server/db';
import { getAccount } from '../../../server/session';
import { InviteView, type InvitePreviewResult } from './invite-view';

const NOT_VALID: InvitePreviewResult = {
  ok: false,
  refusal: { reason: INVITE_REFUSALS.invalid },
};

// An invite link (R-12, R-98). A signed-out visitor signs in, and a new
// account onboards, and both come back here (R-81). A GET never accepts:
// this is a confirm screen, and Accept posts a server action (plan
// decision 8). A malformed token is "not valid" without a lookup, and an
// unknown, expired, used or revoked one reads the same (plan decision 6).
export default async function InvitePage({
  params,
}: {
  readonly params: Promise<{ token: string }>;
}): Promise<JSX.Element> {
  const parsed = inviteTokenSchema.safeParse((await params).token);
  const token = parsed.success ? parsed.data : null;
  const back = token === null ? null : invitePath(token);
  const account = await getAccount();
  if (account === null) redirect(signInPath(back));
  if (accountStage(account) !== 'onboarded') redirect(onboardingPath(back));
  const preview =
    token === null
      ? NOT_VALID
      : await previewInvite(getDb(), token, account.id, new Date());
  return <InviteView token={token ?? ''} preview={preview} />;
}
