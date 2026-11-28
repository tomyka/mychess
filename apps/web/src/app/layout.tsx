import type { JSX, ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { BRAND } from '../lib/brand';
import { themeAttribute } from '../lib/theme';
import { readThemeCookie } from '../server/theme-cookie';
import { inter } from './fonts';
import './globals.css';

// The brand is one name in every language (R-170). The manifest
// (manifest.ts) and the icons beside this file are linked by Next itself.
export const metadata: Metadata = {
  title: BRAND,
  applicationName: BRAND,
  appleWebApp: { title: BRAND },
};

// The phone tab bar sits on the home indicator's inset (#381).
export const viewport: Viewport = { viewportFit: 'cover' };

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const locale = await getLocale();
  const theme = await readThemeCookie();
  return (
    <html
      lang={locale}
      data-theme={themeAttribute(theme)}
      className={inter.variable}
    >
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
