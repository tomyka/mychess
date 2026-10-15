import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, MESSAGES, resolveLocale } from './locales';

// next-intl's per-request configuration (next.config.ts names this file).
export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return { locale, messages: MESSAGES[locale] };
});
