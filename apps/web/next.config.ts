import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// `next build` runs in apps/web; the workspace root is two levels up.
const workspaceRoot = path.resolve(process.cwd(), '../..');

// On every page in every environment: no other site may frame one
// (clickjacking), and no browser may guess a response's type.
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

const config: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  transpilePackages: ['@mychess/domain', '@mychess/chess', '@mychess/db'],
  poweredByHeader: false,
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md into apps/web;
  // this repo's agent rules live in its own CLAUDE.md and docs/.
  agentRules: false,
  reactStrictMode: true,
  // A PGN upload is posted as text to a server action: up to 2 MB (R-66)
  // plus the form's own overhead. The action re-checks every limit.
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
  headers: () =>
    Promise.resolve([{ source: '/:path*', headers: SECURITY_HEADERS }]),
};

// next-intl without locale routing: the locale comes from a cookie
// (src/i18n/request.ts), Lithuanian when there is none.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(config);
