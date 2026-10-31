import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/version/route';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/version', () => {
  it('names the commit the image was built from, uncached', async () => {
    vi.stubEnv('APP_COMMIT', COMMIT);

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    // The release check compares this exact body (infra/ci/verify-release.sh).
    expect(await response.text()).toBe(`{"commit":"${COMMIT}"}`);
  });

  it('answers null where the build named no commit', async () => {
    vi.stubEnv('APP_COMMIT', undefined);

    expect(await GET().json()).toEqual({ commit: null });
  });

  it('answers null for an empty commit', async () => {
    vi.stubEnv('APP_COMMIT', '');

    expect(await GET().json()).toEqual({ commit: null });
  });
});
