import { describe, expect, it } from 'vitest';
import { auditEmailHash } from '../src';
import { TEST_AUDIT_EMAIL_KEY } from '../src/testing';

const OTHER_KEY = 'other-audit-key-0123456789abcdef012';

// R-88, R-94: an audit row names its target by a keyed one-way hash of the
// canonical email, which an operator holding the environment's
// AUDIT_EMAIL_KEY recomputes to ask "was this email ever audited".
describe('auditEmailHash', () => {
  it('is the hex HMAC-SHA-256 of the canonical email under the key', () => {
    // Vectors from `printf '<email>' | openssl dgst -sha256 -hmac '<key>'`.
    expect(TEST_AUDIT_EMAIL_KEY).toBe('test-audit-key-0123456789abcdef0123');
    expect(auditEmailHash('ruta@example.lt', TEST_AUDIT_EMAIL_KEY)).toBe(
      '35ce2f43ee9848c6b83aaa75f6a4297adba1a0b738502cf5622809e5ade2f231',
    );
    expect(auditEmailHash('jonas@example.lt', TEST_AUDIT_EMAIL_KEY)).toBe(
      '0125771cb0111026050c61b54e820849ac90b64df1b5f2712d8f29d40b8bee4d',
    );
  });

  it('gives a different hash under a different key', () => {
    expect(auditEmailHash('ruta@example.lt', OTHER_KEY)).toBe(
      'e0d4264290bc92e0db1762e49df7fde11318f0fe9eeb8cfdab7fd5b792cc4baa',
    );
  });

  it('is not the unkeyed SHA-256 a leaked database could be checked against', () => {
    expect(auditEmailHash('ruta@example.lt', TEST_AUDIT_EMAIL_KEY)).not.toBe(
      'cade0ed8e54971329a51ec35d4e62651c18fa134c22619f504ba27dd38afcca0',
    );
  });

  it('gives the same hash every time for the same email and key', () => {
    expect(auditEmailHash('ruta@example.lt', TEST_AUDIT_EMAIL_KEY)).toBe(
      auditEmailHash('ruta@example.lt', TEST_AUDIT_EMAIL_KEY),
    );
  });
});
