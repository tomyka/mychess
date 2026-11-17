import { isProvider, type Provider } from '@mychess/domain';
import { headers } from 'next/headers';
import { z } from 'zod';
import { getAuth } from './auth';

/** One provider linked to the signed-in account. */
export interface ProviderLink {
  /** The link's own id (`provider_accounts.id`): what unlinking takes. */
  readonly id: string;
  readonly provider: Provider;
}

const linkRowsSchema = z.array(
  z.looseObject({
    id: z.string().min(1),
    providerId: z.string(),
    // The provider's id for the person: for Lichess, the username in
    // lower case (server/oauth/lichess.ts maps its `id`).
    accountId: z.string(),
  }),
);

type LinkRow = z.infer<typeof linkRowsSchema>[number];

/**
 * The links of this request's account, as Better Auth lists them for the
 * session only (parsed at the edge); none for a signed-out visitor.
 */
async function sessionLinks(): Promise<LinkRow[]> {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session === null) return [];
  return linkRowsSchema.parse(
    await getAuth().api.listUserAccounts({ headers: requestHeaders }),
  );
}

/** The Google and Lichess links of this request's account. */
export async function linkedProviders(): Promise<ProviderLink[]> {
  return (await sessionLinks()).flatMap(({ id, providerId }) =>
    isProvider(providerId) ? [{ id, provider: providerId }] : [],
  );
}

/**
 * The session account's Lichess username as Lichess ids it (lower case),
 * or null when Lichess is not linked: the import page's side default
 * (#330 decision 8). Sent only to the account's own browser.
 */
export async function lichessUsername(): Promise<string | null> {
  const links = await sessionLinks();
  return links.find((row) => row.providerId === 'lichess')?.accountId ?? null;
}
