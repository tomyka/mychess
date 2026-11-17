import { cookies } from 'next/headers';
import type { Locale } from '@mychess/domain';
import { getRequestConfig } from 'next-intl/server';
import { DISPLAY_TIME_ZONE } from '../lib/time-zone';
import { getAccount } from '../server/session';
import { LOCALE_COOKIE, MESSAGES, resolveLocale } from './locales';

// next-intl's per-request configuration (next.config.ts names this file).
// Once signed in, the account's locale wins over the cookie; either is
// served only if it is offered (R-180: English only for now).
export async function requestConfigFor(): Promise<{
  locale: Locale;
  messages: (typeof MESSAGES)[Locale];
  timeZone: string;
}> {
  const account = await getAccount();
  const store = await cookies();
  const locale = resolveLocale(
    account?.locale ?? store.get(LOCALE_COOKIE)?.value,
  );
  // One zone on the server and in the browser (#331): a date formatted
  // without its own zone would otherwise differ and break hydration.
  return { locale, messages: MESSAGES[locale], timeZone: DISPLAY_TIME_ZONE };
}

// next-intl's per-request entry; tests call requestConfigFor directly so they
// need not pass next-intl's deprecated `requestLocale` parameter.
export default getRequestConfig(requestConfigFor);
