import type { Locale } from '@mychess/domain';
import type { MESSAGES } from './locales';

// next-intl's typed keys: t('app.titel') is a type error.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: (typeof MESSAGES)['lt'];
  }
}
