import { headers } from 'next/headers';
import { z } from 'zod';
import { isProvider, type Provider } from '../lib/providers';
import { getAuth } from './auth';

/** One provider linked to the signed-in account. */
export interface ProviderLink {
  /** The link's own id (`provider_accounts.id`): what unlinking takes. */
  readonly id: string;
  readonly provider: Provider;
}

const linkRowsSchema = z.array(
  z.looseObject({ id: z.string().min(1), providerId: z.string() }),
);

/**
 * The Google and Lichess links of this request's account, as Better Auth
 * lists them (parsed at the edge); none for a signed-out visitor.
 */
export async function linkedProviders(): Promise<ProviderLink[]> {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session === null) return [];
  const rows = linkRowsSchema.parse(
    await getAuth().api.listUserAccounts({ headers: requestHeaders }),
  );
  return rows.flatMap(({ id, providerId }) =>
    isProvider(providerId) ? [{ id, provider: providerId }] : [],
  );
}
