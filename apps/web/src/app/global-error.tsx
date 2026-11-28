'use client';

import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { LOCALE, MESSAGES } from '../i18n/catalogue';
import { ErrorView } from './error-view';
import './globals.css';

/**
 * The error page for when the root layout itself fails (#381 part 6). It
 * replaces that layout, so it brings the document, the theme tokens (the
 * system's theme: the cookie is the server's to read) and the messages it
 * needs.
 */
export default function GlobalError({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}): JSX.Element {
  return (
    <html lang={LOCALE}>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider
          locale={LOCALE}
          messages={{ error: MESSAGES.error, nav: MESSAGES.nav }}
        >
          <ErrorView reset={reset} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
