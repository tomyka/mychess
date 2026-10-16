import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { getAccount } from '../server/session';
import { LOCALE_COOKIE, MESSAGES, resolveLocale } from './locales';

// next-intl's per-request configuration (next.config.ts names this file).
// Once signed in, the account's locale wins over the cookie.
export default getRequestConfig(async () => {
  const account = await getAccount();
  const store = await cookies();
  const locale =
    account?.locale ?? resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return { locale, messages: MESSAGES[locale] };
});
