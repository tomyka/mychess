import type { JSX, ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { BRAND } from '../lib/brand';
import { THEME_COOKIE, parseTheme, themeAttribute } from '../lib/theme';
import './globals.css';

// Inter (R-219), downloaded at build time and served from this site: no
// request to Google at runtime. tokens.css puts --font-inter first in
// --font-sans, with the system stack behind it.
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
});

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
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
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
