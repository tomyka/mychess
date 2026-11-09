import type { JSX, ReactNode } from 'react';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { BRAND } from '../lib/brand';
import './globals.css';

// The brand is one name in every language (R-170). The manifest
// (manifest.ts) and the icons beside this file are linked by Next itself.
export const metadata: Metadata = {
  title: BRAND,
  applicationName: BRAND,
  appleWebApp: { title: BRAND },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
