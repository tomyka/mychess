import type { MetadataRoute } from 'next';
import { BRAND } from '../lib/brand';

// The light theme's accent and page colours from tokens.css: a manifest
// takes one colour, not light-dark(); manifest.test.ts keeps them in step.
const ACCENT = '#0b63c5';
const PAGE = '#f4f5f8';

/**
 * The web app manifest (R-7: installable as a PWA; R-170: the brand is
 * MyChess), served at /manifest.webmanifest and linked from every page.
 * The icons in public/icons are placeholders until ux-designer draws them.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND,
    short_name: BRAND,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: ACCENT,
    background_color: PAGE,
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
