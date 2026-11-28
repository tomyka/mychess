import type { InviteTeaser } from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { teaserOf } from './invite-teaser';

const DB = { db: 'teaser' };

const server = vi.hoisted(() => ({
  teaser:
    vi.fn<
      (
        db: unknown,
        token: string,
        now: Date,
      ) => Promise<InviteTeaser | undefined>
    >(),
}));

vi.mock('@mychess/db', () => ({ inviteTeaser: server.teaser }));
vi.mock('./db', () => ({ getDb: () => DB }));

const TOKEN = `${'A'.repeat(42)}_`;
const TEASER: InviteTeaser = {
  coachDisplayName: 'Rimantas V.',
  groupName: 'Juniors 2026',
};

beforeEach(() => {
  server.teaser.mockReset().mockResolvedValue(TEASER);
});

describe('teaserOf (R-235)', () => {
  it("gives a valid invite's coach and group, for its return path", async () => {
    expect(await teaserOf(`/invite/${TOKEN}`)).toEqual(TEASER);
    expect(server.teaser).toHaveBeenCalledExactlyOnceWith(
      DB,
      TOKEN,
      expect.any(Date),
    );
  });

  it('gives null when the invite names no one', async () => {
    server.teaser.mockResolvedValue(undefined);
    expect(await teaserOf(`/invite/${TOKEN}`)).toBeNull();
  });

  it('never looks up a malformed token, another path or none', async () => {
    expect(await teaserOf('/invite/short')).toBeNull();
    expect(await teaserOf(`/invite/${TOKEN}x`)).toBeNull();
    expect(await teaserOf('/settings')).toBeNull();
    expect(await teaserOf(null)).toBeNull();
    expect(server.teaser).not.toHaveBeenCalled();
  });
});
