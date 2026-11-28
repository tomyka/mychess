import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import InvitePage from './page';

const server = vi.hoisted(() => ({
  preview:
    vi.fn<
      (
        db: unknown,
        token: string,
        playerId: string,
        now: Date,
      ) => Promise<unknown>
    >(),
}));

vi.mock('@mychess/db', async (original) => ({
  ...(await original<typeof import('@mychess/db')>()),
  previewInvite: server.preview,
}));
vi.mock('../../../server/db', () => ({ getDb: () => ({}) }));
vi.mock('../../../server/session', () => ({
  getAccount: () =>
    Promise.resolve({
      id: 'p1',
      onboardedAt: new Date('2026-10-01'),
      disabledAt: null,
    }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect to ${to}`);
  },
}));
// The view is a client component; only what the page hands it matters here.
vi.mock('./invite-view', () => ({ InviteView: () => null }));

const TOKEN = `${'A'.repeat(42)}_`;
const ACTIVE = {
  ok: true,
  value: {
    state: 'active',
    coachDisplayName: 'Rimantas V.',
    groupName: null,
    kind: 'personal',
    assignments: [],
  },
};

const handed = z.object({
  props: z.object({
    token: z.string(),
    preview: z.unknown(),
    today: z.string(),
  }),
});

const open = async (token: string) =>
  handed.parse(await InvitePage({ params: Promise.resolve({ token }) })).props;

beforeEach(() => {
  server.preview.mockReset().mockResolvedValue(ACTIVE);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the invite page, what it hands its view', () => {
  it("hands today's Vilnius day for the deadlines, read at the preview's instant", async () => {
    // 23:30 UTC on 28 Nov is already 29 Nov in Vilnius.
    vi.setSystemTime(new Date('2026-11-28T23:30:00Z'));
    const props = await open(TOKEN);
    expect(props).toEqual({
      token: TOKEN,
      preview: ACTIVE,
      today: '2026-11-29',
    });
    const [, , playerId, now] = server.preview.mock.lastCall ?? [];
    expect(playerId).toBe('p1');
    expect(now?.toISOString()).toBe('2026-11-28T23:30:00.000Z');
  });

  it('hands a malformed token as not valid, without a lookup', async () => {
    vi.setSystemTime(new Date('2026-11-28T10:00:00Z'));
    expect(await open('short')).toEqual({
      token: '',
      preview: { ok: false, refusal: { reason: 'invite.invalid' } },
      today: '2026-11-28',
    });
    expect(server.preview).not.toHaveBeenCalled();
  });
});
