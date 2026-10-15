import type { Locale, MESSAGES } from './locales';

// next-intl's typed keys: t('app.titel') is a type error.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: (typeof MESSAGES)['lt'];
  }
}
