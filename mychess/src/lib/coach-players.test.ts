import { describe, it, expect } from 'vitest';
import { planRequest } from './coach-players';

describe('planRequest', () => {
	it('allows a request when no relationship exists yet', () => {
		expect(planRequest(null, 'me')).toEqual({ ok: true });
	});

	it('rejects a request when an active relationship already exists', () => {
		const result = planRequest({ status: 'active', requested_by: 'someone' }, 'me');
		expect(result).toEqual({ ok: false, error: 'You already have an active relationship.' });
	});

	it('rejects a duplicate request from the same requester', () => {
		const result = planRequest({ status: 'pending', requested_by: 'me' }, 'me');
		expect(result).toEqual({
			ok: false,
			error: 'You already sent a request — waiting for a response.'
		});
	});

	it('rejects a new request when the other side already sent one', () => {
		const result = planRequest({ status: 'pending', requested_by: 'them' }, 'me');
		expect(result).toEqual({
			ok: false,
			error: 'There is already a pending request between you — respond to it instead.'
		});
	});
});
