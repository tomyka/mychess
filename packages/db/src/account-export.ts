import {
  accountSchema,
  inviteState,
  type Entitlement,
  type InviteKind,
  type InviteState,
  type Locale,
} from '@mychess/domain';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { accountColumns } from './accounts';
import type { Executor } from './client';
import { playerCoaches } from './coaching';
import { coachGroups } from './groups';
import { allCoachInvites } from './invites';
import { accounts, providerAccounts, sessions } from './schema';

/** The account's coaching data (R-106); never a token, its hash or an id. */
export interface CoachingExport {
  /** As a player: the coaches linked to, with the account's groups of each. */
  readonly coaches: readonly {
    readonly displayName: string;
    readonly linkedAt: string;
    readonly groups: readonly string[];
  }[];
  /** As a coach: the account's groups, by name. */
  readonly groups: readonly {
    readonly name: string;
    readonly createdAt: string;
  }[];
  /** As a coach: every invite the account made, oldest first. */
  readonly invites: readonly {
    readonly kind: InviteKind;
    readonly groupName: string | null;
    readonly state: InviteState;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly revokedAt: string | null;
    readonly usedAt: string | null;
  }[];
}

export interface AccountExport {
  readonly account: {
    readonly email: string;
    readonly displayName: string;
    readonly locale: Locale;
    readonly image: string | null;
    readonly entitlement: Entitlement;
    /** ISO time, or null before onboarding. */
    readonly onboardedAt: string | null;
    /** ISO time Coach mode was switched on, or null while it is off. */
    readonly coachSince: string | null;
    readonly createdAt: string;
  };
  readonly linkedProviders: readonly {
    readonly provider: string;
    readonly linkedAt: string;
  }[];
  /** The account's active sessions, oldest first (R-89); never a token. */
  readonly sessions: readonly {
    readonly ipAddress: string | null;
    readonly userAgent: string | null;
    readonly createdAt: string;
    readonly expiresAt: string;
  }[];
  readonly coaching: CoachingExport;
}

const exportRowSchema = accountSchema.extend({
  image: z.string().nullable(),
});

const linkRowsSchema = z.array(
  z.object({ provider: z.string().min(1), linkedAt: z.date() }),
);

const sessionRowsSchema = z.array(
  z.object({
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.date(),
    expiresAt: z.date(),
  }),
);

const iso = (at: Date | null): string | null => at?.toISOString() ?? null;

/** The sessions of `id` that have not expired at `now`, oldest first. */
async function activeSessions(
  db: Executor,
  id: string,
  now: Date,
): Promise<AccountExport['sessions']> {
  const rows = sessionRowsSchema.parse(
    await db
      .select({
        ipAddress: sessions.ipAddress,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(and(eq(sessions.accountId, id), gt(sessions.expiresAt, now)))
      .orderBy(sessions.createdAt, sessions.id),
  );
  return rows.map((row) => ({
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

/** The account's coaching data at `now` (R-106). */
async function coaching(
  db: Executor,
  id: string,
  now: Date,
): Promise<CoachingExport> {
  const coaches = await playerCoaches(db, id);
  const groups = await coachGroups(db, id);
  const invites = await allCoachInvites(db, id);
  return {
    coaches: coaches.map((coach) => ({
      displayName: coach.displayName,
      linkedAt: coach.linkedAt.toISOString(),
      groups: coach.groups.map((group) => group.name),
    })),
    groups: groups.map((group) => ({
      name: group.name,
      createdAt: group.createdAt.toISOString(),
    })),
    invites: invites.map((invite) => ({
      kind: invite.kind,
      groupName: invite.groupName,
      state: inviteState(invite, now),
      createdAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
      revokedAt: iso(invite.revokedAt),
      usedAt: iso(invite.usedAt),
    })),
  };
}

/**
 * The requester's own data (R-40, security item 9), with the sessions
 * active at `now` (R-89) and the coaching data (R-106); never tokens.
 */
export async function exportAccount(
  db: Executor,
  id: string,
  now: Date,
): Promise<AccountExport | undefined> {
  const [row] = await db
    .select({ ...accountColumns, image: accounts.image })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  if (row === undefined) return undefined;
  const account = exportRowSchema.parse(row);
  const links = linkRowsSchema.parse(
    await db
      .select({
        provider: providerAccounts.providerId,
        linkedAt: providerAccounts.createdAt,
      })
      .from(providerAccounts)
      .where(eq(providerAccounts.ownerAccountId, id))
      .orderBy(providerAccounts.createdAt, providerAccounts.id),
  );
  return {
    account: {
      email: account.email,
      displayName: account.displayName,
      locale: account.locale,
      image: account.image,
      entitlement: account.entitlement,
      onboardedAt: iso(account.onboardedAt),
      coachSince: iso(account.coachSince),
      createdAt: account.createdAt.toISOString(),
    },
    linkedProviders: links.map((link) => ({
      provider: link.provider,
      linkedAt: link.linkedAt.toISOString(),
    })),
    sessions: await activeSessions(db, id, now),
    coaching: await coaching(db, id, now),
  };
}
