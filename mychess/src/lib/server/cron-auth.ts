// mychess/src/lib/server/cron-auth.ts
import { timingSafeEqual, createHmac } from 'crypto';
import { error } from '@sveltejs/kit';

const HMAC_KEY = Buffer.from('timing-safe-compare');

// Hash both sides to fixed-length output to prevent length-based timing side-channel
function safeCompare(a: string, b: string): boolean {
  const ha = createHmac('sha256', HMAC_KEY).update(a).digest();
  const hb = createHmac('sha256', HMAC_KEY).update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Verifies the request's `Authorization: Bearer <token>` header against CRON_SECRET; throws a 401 if missing or mismatched. */
export function requireCronAuth(request: Request, cronSecret: string | undefined): void {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!cronSecret || !safeCompare(token, cronSecret)) {
    throw error(401, 'Unauthorized');
  }
}
