import {
  accountSchema,
  inviteState,
  type Entitlement,
  type InviteKind,
  type InviteState,
  type Locale,
} from '@mychess/domain';
import {
  exportPgn,
  fenOf,
  parseMoveKey,
  type Chapter,
  type Side,
} from '@mychess/chess';
import { and, asc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { accountColumns } from './accounts';
import type { Executor } from './client';
import { playerCoaches } from './coaching';
import { coachGroups } from './groups';
import { allCoachInvites } from './invites';
import { loadRepertoires } from './repertoires/repository';
import {
  accounts,
  personalNotes,
  providerAccounts,
  repertoires,
  sessions,
} from './schema';

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
  /** The account's repertoires, each as PGN (R-40), oldest first. */
  readonly repertoires: readonly {
    readonly name: string;
    readonly side: Side;
    readonly createdAt: string;
    readonly pgn: string;
  }[];
  /** The account's personal notes (R-21), by repertoire name and move. */
  readonly personalNotes: readonly {
    readonly repertoire: string;
    /**
     * The position the move is played from, as a FEN (fenOf); for a
     * malformed stored key, the key as stored.
     */
    readonly position: string;
    /** The move's SAN; '' for a malformed stored key. */
    readonly san: string;
    readonly text: string;
    readonly updatedAt: string;
  }[];
}

export interface AccountExportOptions {
  /**
   * How a chapter's PGN game is titled: its display name in the account's
   * language (decision 14). The default is the name source itself.
   */
  readonly chapterTitle?: (chapter: Chapter) => string;
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

/** The account's own repertoires, oldest first, each as PGN (R-40). */
async function exportedRepertoires(
  db: Executor,
  id: string,
  options: AccountExportOptions,
): Promise<AccountExport['repertoires']> {
  const pgnOptions =
    options.chapterTitle === undefined ? {} : { title: options.chapterTitle };
  return (await loadRepertoires(db, id)).map(({ repertoire, graph }) => ({
    name: repertoire.name,
    side: repertoire.side,
    createdAt: repertoire.createdAt.toISOString(),
    pgn: exportPgn(graph, pgnOptions),
  }));
}

const noteRowsSchema = z.array(
  z.object({
    repertoire: z.string(),
    moveKey: z.string(),
    text: z.string(),
    updatedAt: z.date(),
  }),
);

/**
 * Where a note's move is played from, as a FEN, and its SAN. A key that is
 * not a move key (a bad row) is exported as it is stored, with no SAN, so
 * it can never break the export.
 */
function notedMove(key: string): { position: string; san: string } {
  const parts = parseMoveKey(key);
  return parts === null
    ? { position: key, san: '' }
    : { position: fenOf(parts.fromKey), san: parts.san };
}

/** The account's personal notes, by repertoire (oldest first), then move key. */
async function exportedNotes(
  db: Executor,
  id: string,
): Promise<AccountExport['personalNotes']> {
  const rows = noteRowsSchema.parse(
    await db
      .select({
        repertoire: repertoires.name,
        moveKey: personalNotes.moveKey,
        text: personalNotes.text,
        updatedAt: personalNotes.updatedAt,
      })
      .from(personalNotes)
      .innerJoin(repertoires, eq(repertoires.id, personalNotes.repertoireId))
      .where(eq(personalNotes.playerAccountId, id))
      .orderBy(
        asc(repertoires.createdAt),
        asc(repertoires.id),
        asc(personalNotes.moveKey),
      ),
  );
  return rows.map((row) => ({
    repertoire: row.repertoire,
    ...notedMove(row.moveKey),
    text: row.text,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * The requester's own data (R-40, security item 9), with the sessions
 * active at `now` (R-89), the coaching data (R-106), the repertoires as
 * PGN and the personal notes (R-21); never tokens.
 */
export async function exportAccount(
  db: Executor,
  id: string,
  now: Date,
  options: AccountExportOptions = {},
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
    repertoires: await exportedRepertoires(db, id, options),
    personalNotes: await exportedNotes(db, id),
  };
}
