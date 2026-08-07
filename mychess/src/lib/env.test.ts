// mychess/src/lib/env.test.ts
import { describe, it, expect } from 'vitest';
import { requireEnv } from './env';

describe('requireEnv', () => {
	it('returns the value when present', () => {
		expect(requireEnv('abc', 'FOO')).toBe('abc');
	});

	it('throws a clear error naming the missing variable when undefined', () => {
		expect(() => requireEnv(undefined, 'FOO')).toThrow('Missing required environment variable: FOO');
	});

	it('throws for an empty string too, not just undefined', () => {
		expect(() => requireEnv('', 'FOO')).toThrow('Missing required environment variable: FOO');
	});
});
