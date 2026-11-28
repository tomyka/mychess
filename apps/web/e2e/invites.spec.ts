// #381 part 6 (plan Task 16): a group invite opened signed out. Sign-in and
// welcome name the coach before the player has an account (R-235), the
// confirm screen lists what the group comes with (R-236), and Accept lands
// on Today with a one-time "linked with" line (R-234). The coach is the
// coach persona (docs/personas/coach.md) on a fresh test account.
import { expect, type BrowserContext } from '@playwright/test';
import {
  COACH,
  GROUP,
  ROKAS,
  coachReady,
  expectAssigned,
  type Cast,
} from './support/assignment-people';
import {
  assignTo,
  fixture,
  importRepertoire,
  vilniusDay,
} from './support/assignments';
import {
  acceptInvite,
  createGroup,
  expectInviteFrom,
  signUpThroughInvite,
} from './support/coaching';
import { en, format, newDevice, test } from './support/journey';

/** The coach persona's Caro-Kann (docs/personas/coach.md), as assignments.spec.ts imports it. */
const KARO_KAN = 'Karo-Kan gynyba: pagrindai';

/** A short deadline as the confirm screen writes it ("Jan 27", or "Jan 27, 2027"). */
const SHORT_DATE = '[A-Z][a-z]{2} \\d{1,2}(, \\d{4})?';

const escape = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

test(
  'R-234, R-235, R-236: a group invite opened signed out names its coach, lists what it comes with, and lands on Today linked',
  { tag: '@mobile' },
  async ({ page: coach, request, browser }) => {
    test.setTimeout(240_000);
    const devices: BrowserContext[] = [];
    const cast: Cast = { messages: en, browser, request, devices };
    try {
      // The coach's group, its link, and the Caro-Kann assigned to it.
      await coachReady(coach, cast);
      const link = await createGroup(coach, en, GROUP);
      const deadline = vilniusDay(30);
      await importRepertoire(coach, en, {
        file: fixture('karo-kan.pgn'),
        side: 'black',
        name: KARO_KAN,
      });
      await assignTo(coach, en, { target: GROUP, deadline });

      // A fresh browser, signed out: sign-in and welcome name the coach.
      const context = await newDevice(browser);
      devices.push(context);
      const player = await context.newPage();
      await signUpThroughInvite(player, request, {
        link,
        name: ROKAS,
        from: { coach: COACH, group: GROUP },
      });

      // The confirm screen: whose group, and what it comes with.
      await expectInviteFrom(player, en, { coach: COACH, group: GROUP });
      const comesWith = player.getByRole('region', {
        name: en.invite.comesWith,
        exact: true,
      });
      const [before = '', after = ''] =
        en.coach.status.deadline.split('{date}');
      await expect(
        comesWith.getByRole('listitem').filter({
          hasText: new RegExp(
            `^${escape(KARO_KAN)} · ${before}${SHORT_DATE}${after}$`,
            'u',
          ),
        }),
      ).toHaveCount(1);

      // Accept: Today says through which group, and lists the assignment.
      await acceptInvite(player, en);
      const linked = player.getByRole('status').filter({
        hasText: format(en.today.linkedThrough, { coach: COACH, group: GROUP }),
      });
      await expect(linked).toBeVisible();
      await expectAssigned(player, cast, KARO_KAN, deadline);

      // Said once: a reload drops the line and keeps the assignment.
      await player.reload();
      await expectAssigned(player, cast, KARO_KAN, deadline);
      await expect(linked).toHaveCount(0);
    } finally {
      for (const device of devices) await device.close();
    }
  },
);
