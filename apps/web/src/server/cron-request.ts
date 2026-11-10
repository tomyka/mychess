import { z } from 'zod';
import { sameSecret } from './same-secret';

const cronEnvSchema = z.object({ CRON_SECRET: z.string().min(32).optional() });

/**
 * The answer a scheduled job's request is refused with, or undefined when
 * it carries `Authorization: Bearer <CRON_SECRET>` (#234): absent (404)
 * where CRON_SECRET is not set, 401 for any other header. The VM's systemd
 * timers are the only callers. Machine-readable, not user text.
 */
export function cronRefusal(request: Request): Response | undefined {
  const { CRON_SECRET } = cronEnvSchema.parse(process.env);
  if (CRON_SECRET === undefined) return new Response(null, { status: 404 });
  const given = request.headers.get('authorization') ?? '';
  if (!sameSecret(given, `Bearer ${CRON_SECRET}`)) {
    return new Response(null, { status: 401 });
  }
  return undefined;
}
