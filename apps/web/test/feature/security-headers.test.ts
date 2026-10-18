import { describe, expect, it } from 'vitest';
import config from '../../next.config';

describe('the security headers on every page', () => {
  it('forbid framing and type sniffing, and keep URLs off other sites', async () => {
    expect(await config.headers?.()).toEqual([
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // An invite link carries its token in the path (/k/<token>): a
          // link followed from that page must not send it on.
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ]);
  });
});
