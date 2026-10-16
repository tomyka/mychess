import { useTestDatabase } from '@mychess/db/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/health/route';

const { url } = useTestDatabase();

// Nothing listens on port 1: the connection is refused at once.
const UNREACHABLE_URL = 'postgres://mychess:mychess@127.0.0.1:1/mychess';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/health', () => {
  it('answers ok when the database is reachable', async () => {
    vi.stubEnv('DATABASE_URL', url);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', database: 'up' });
  });

  it('answers 503 when the database cannot be reached', async () => {
    vi.stubEnv('DATABASE_URL', UNREACHABLE_URL);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'unavailable',
      database: 'down',
    });
  });

  it('refuses to run without a DATABASE_URL', async () => {
    vi.stubEnv('DATABASE_URL', undefined);

    await expect(GET()).rejects.toThrow(/DATABASE_URL/);
  });
});
