import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { getAccount } from '../server/session';
import { LOCALE_COOKIE, MESSAGES, resolveLocale } from './locales';

// next-intl's per-request configuration (next.config.ts names this file).
// Once signed in, the account's locale wins over the cookie; either is
// served only if it is offered (R-180: English only for now).
export default getRequestConfig(async () => {
  const account = await getAccount();
  const store = await cookies();
  const locale = resolveLocale(
    account?.locale ?? store.get(LOCALE_COOKIE)?.value,
  );
  return { locale, messages: MESSAGES[locale] };
});
