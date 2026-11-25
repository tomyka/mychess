import { getRequestConfig } from 'next-intl/server';
import { DISPLAY_TIME_ZONE } from '../lib/time-zone';
import { LOCALE, MESSAGES } from './catalogue';

// next-intl's per-request configuration (next.config.ts names this file).
export function requestConfigFor(): Promise<{
  locale: typeof LOCALE;
  messages: typeof MESSAGES;
  timeZone: string;
}> {
  // One zone on the server and in the browser (#331): a date formatted
  // without its own zone would otherwise differ and break hydration.
  return Promise.resolve({
    locale: LOCALE,
    messages: MESSAGES,
    timeZone: DISPLAY_TIME_ZONE,
  });
}

// next-intl's per-request entry; tests call requestConfigFor directly so they
// need not pass next-intl's deprecated `requestLocale` parameter.
export default getRequestConfig(requestConfigFor);
