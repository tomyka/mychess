import type { LOCALE, MESSAGES } from './catalogue';

// next-intl's typed keys: t('app.titel') is a type error.
declare module 'next-intl' {
  interface AppConfig {
    Locale: typeof LOCALE;
    Messages: typeof MESSAGES;
  }
}
