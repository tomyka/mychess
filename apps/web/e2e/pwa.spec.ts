import { expect } from '@playwright/test';
import { test } from './support/journey';

// R-7: the app installs as a PWA, named MyChess (R-170). Chrome needs a
// linked manifest with a name, a start URL, a standalone display and a 192
// and a 512 icon; drilling stays online-only, so there is no service worker.
// Opening the installed app (U1-M1-3) starts here: the page links what the
// browser installs from.

test('U1-M1-3: every page links the MyChess manifest, and its icons load', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const link = page.locator('head link[rel="manifest"]');
  await expect(link).toHaveAttribute('href', '/manifest.webmanifest');

  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest: unknown = await response.json();
  expect(manifest).toMatchObject({
    name: 'MyChess',
    short_name: 'MyChess',
    display: 'standalone',
    start_url: '/',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192' },
      { src: '/icons/icon-512.png', sizes: '512x512' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512' },
    ],
  });

  const icons = [
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-512.png',
    '/favicon.ico',
    '/apple-icon.png',
  ];
  for (const src of icons) {
    const icon = await request.get(src);
    expect(icon.ok(), src).toBe(true);
    expect(icon.headers()['content-type'], src).toMatch(/^image\//u);
  }
});
