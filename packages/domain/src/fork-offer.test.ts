import { describe, expect, it } from 'vitest';
import {
  FORK_OFFER_DAYS,
  FORK_OFFER_REASONS,
  FORK_OFFER_REFUSALS,
  canAnswerForkOffer,
  forkOfferExpiry,
  forkOfferState,
  type ForkOfferFacts,
  type ForkOfferState,
} from './fork-offer';

const created = new Date('2026-10-20T10:00:00Z');
const expiry = new Date('2026-11-19T10:00:00Z');
const offer = (over: Partial<ForkOfferFacts> = {}): ForkOfferFacts => ({
  expiresAt: forkOfferExpiry(created),
  acceptedAt: null,
  declinedAt: null,
  closedAt: null,
  ...over,
});

describe('FORK_OFFER_REFUSALS', () => {
  it('are message-catalogue keys', () => {
    expect(FORK_OFFER_REFUSALS).toStrictEqual({ notOpen: 'forkOffer.notOpen' });
  });
});

describe('forkOfferExpiry', () => {
  it('is 30 days after the assignment ended (R-44)', () => {
    expect(FORK_OFFER_DAYS).toBe(30);
    expect(forkOfferExpiry(created)).toStrictEqual(expiry);
  });

  it('does not change the date it is given', () => {
    const at = new Date(created);
    forkOfferExpiry(at);
    expect(at).toStrictEqual(created);
  });
});

describe('forkOfferState', () => {
  const later = new Date('2026-10-25T00:00:00Z');
  it.each<[string, ForkOfferFacts, Date, ForkOfferState]>([
    ['open when just made', offer(), created, 'open'],
    ['open until it expires', offer(), new Date(expiry.getTime() - 1), 'open'],
    ['expired at its expiry', offer(), expiry, 'expired'],
    [
      'expired after its expiry',
      offer(),
      new Date('2026-12-01T00:00:00Z'),
      'expired',
    ],
    ['accepted', offer({ acceptedAt: later }), later, 'accepted'],
    [
      'accepted even after its expiry',
      offer({ acceptedAt: later }),
      expiry,
      'accepted',
    ],
    ['declined', offer({ declinedAt: later }), later, 'declined'],
    [
      'declined even after its expiry',
      offer({ declinedAt: later }),
      expiry,
      'declined',
    ],
    [
      'closed when assigned again (lead decision 4)',
      offer({ closedAt: later }),
      later,
      'closed',
    ],
    [
      'closed even after its expiry',
      offer({ closedAt: later }),
      expiry,
      'closed',
    ],
    [
      'accepted before declined or closed',
      offer({ acceptedAt: later, declinedAt: later, closedAt: later }),
      later,
      'accepted',
    ],
    [
      'declined before closed',
      offer({ declinedAt: later, closedAt: later }),
      later,
      'declined',
    ],
  ])('is %s', (_, o, now, state) => {
    expect(forkOfferState(o, now)).toBe(state);
  });
});

describe('canAnswerForkOffer', () => {
  const notOpen = { ok: false, refusal: { reason: 'forkOffer.notOpen' } };
  it.each<[string, ForkOfferFacts, Date, unknown]>([
    ['an open offer', offer(), created, { ok: true, value: undefined }],
    ['not a declined one', offer({ declinedAt: created }), created, notOpen],
    ['not an accepted one', offer({ acceptedAt: created }), created, notOpen],
    ['not a closed one', offer({ closedAt: created }), created, notOpen],
    ['not an expired one', offer(), expiry, notOpen],
  ])('answers %s', (_, o, now, expected) => {
    expect(canAnswerForkOffer(o, now)).toStrictEqual(expected);
  });
});

describe('FORK_OFFER_REASONS', () => {
  it('names each way an assignment ends', () => {
    expect(FORK_OFFER_REASONS).toStrictEqual([
      'unassigned',
      'unlinked',
      'leftGroup',
      'deleted',
    ]);
  });
});
