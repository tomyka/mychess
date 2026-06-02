import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, createState, verifyState } from './oauth';

describe('generateCodeVerifier', () => {
  it('returns a base64url string of at least 43 characters', () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
  });

  it('returns different values on each call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe('generateCodeChallenge', () => {
  it('returns correct base64url SHA-256 per RFC 7636 test vector', async () => {
    // RFC 7636 §B: verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    //              challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const challenge = await generateCodeChallenge(
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    );
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('createState / verifyState', () => {
  const secret = 'test-secret-at-least-32-bytes-long!!';

  it('round-trips: verifyState returns userId for fresh state', async () => {
    const state = await createState('user-123', secret);
    const userId = await verifyState(state, secret);
    expect(userId).toBe('user-123');
  });

  it('throws on tampered payload', async () => {
    const state = await createState('user-123', secret);
    const dotIdx = state.lastIndexOf('.');
    const tampered = 'user-evil' + state.slice('user-123'.length, dotIdx) + '.' + state.slice(dotIdx + 1);
    await expect(verifyState(tampered, secret)).rejects.toThrow();
  });

  it('throws on expired state (timestamp > 5 min old)', async () => {
    const oldTs = Date.now() - 6 * 60 * 1000;
    const state = await createState('user-123', secret, 'fixed-nonce', oldTs);
    await expect(verifyState(state, secret)).rejects.toThrow('expired');
  });

  it('throws with wrong secret', async () => {
    const state = await createState('user-123', secret);
    await expect(verifyState(state, 'wrong-secret')).rejects.toThrow();
  });

  it('throws on state with non-numeric timestamp', async () => {
    const state = await createState('user-123', secret, 'fixed-nonce', 'not-a-number' as unknown as number);
    await expect(verifyState(state, secret)).rejects.toThrow('invalid state format');
  });
});
