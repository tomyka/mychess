import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// `next build` runs in apps/web; the workspace root is two levels up.
const workspaceRoot = path.resolve(process.cwd(), '../..');

// On every page in every environment: no other site may frame one
// (clickjacking), no browser may guess a response's type, and no URL is
// sent to another site as the referrer: an invite link carries its token
// in the path (/k/<token>).
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  // A self-contained server in .next/standalone, which the Dockerfile copies
  // into the production image (ADR 0010).
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  transpilePackages: [
    '@mychess/domain',
    '@mychess/chess',
    '@mychess/db',
    '@mychess/integrations',
  ],
  poweredByHeader: false,
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md into apps/web;
  // this repo's agent rules live in its own CLAUDE.md and docs/.
  agentRules: false,
  reactStrictMode: true,
  // A PGN upload is posted as text to a server action: up to 2 MB (R-66)
  // plus the form's own overhead. The action re-checks every limit.
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
  headers: () =>
    Promise.resolve([
      { source: '/:path*', headers: SECURITY_HEADERS },
      // The FIDE ID search (#316, security requirements of task 4): an
      // opponent's ID is typed there, so no URL leaves it as a referrer,
      // not even to this site. Next applies the last matching value of a
      // header, so this one wins on /fide.
      {
        source: '/fide',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ]),
};

// next-intl without locale routing: the locale comes from a cookie
// (src/i18n/request.ts), Lithuanian when there is none.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(config);
