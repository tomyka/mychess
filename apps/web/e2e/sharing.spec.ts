// S4 journey G-M1-3 (plan Task B8): Gabija shares her Taimanov with her
// coach Rimantas, who reads it read-only and writes a coach note; she reads
// the note under his name; unsharing and unlinking each end his access and
// take his notes with them (R-42, R-107, R-124, R-125, R-127).
import { fileURLToPath } from 'node:url';
import {
  expect,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  acceptInvite,
  createInvite,
  expectInviteFrom,
  switchOnCoachMode,
} from './support/coaching';
import {
  en,
  format,
  newDevice,
  newOnboardedAccount,
  test,
  type Messages,
} from './support/journey';
import {
  backToRepertoire,
  chip,
  chooseChapter,
  distinctTitle,
  openRepertoireOptions,
  plural,
  previewImport,
} from './support/repertoires';

const COACH = 'Rimantas Vaitkus';
const PLAYER = 'Gabija Navickaitė';
const REPERTOIRE = 'Taimanovas';

/** Gabija's six Taimanov lines (and one broken game the import skips). */
const TAIMANOV = fileURLToPath(
  new URL('fixtures/taimanov.pgn', import.meta.url),
);
/**
 * The first chapter (6.Be3), whose 9...Ne5 carries the comment below, by
 * its opening name. Its 3.Nc3 chapter shares the name, so the title carries
 * the ECO code and the move it parts at (R-158).
 */
const TAIMANOV_B48 = distinctTitle(en, {
  name: 'Sicilian Defense: Taimanov Variation, Bastrikov Variation, English Attack',
  eco: 'B48',
  move: '6. Be3',
});
const COMMENT = 'Juodieji spaudžia c4 langelį.';
/** Gabija's private note on 9...Ne5: no coach ever reads it (R-21). */
const PERSONAL_NOTE = 'Asmeninis: čia dažnai suklystu.';
/** Rimantas's coach note on the same move. */
const COACH_NOTE = 'Po 10.Nb3 žaisk b5 iš karto.';

/** 9...Ne5's chip: the comment, and then the marks `extra` names. */
const ne5 = (page: Page, messages: Messages, ...extra: string[]): Locator =>
  chip(
    page,
    ['9... Ne5', messages.repertoires.moves.hasComment, ...extra].join(', '),
  );

/** The "Share with a coach" section of her Repertoire screen (R-226). */
const shareSection = (page: Page, messages: Messages): Locator =>
  page.getByRole('region', { name: messages.share.title });

/** Rimantas: Coach mode on, a personal invite; returns its link. */
async function coachInvites(page: Page): Promise<string> {
  await switchOnCoachMode(page, en);
  await page.goto('/coach');
  return createInvite(page, en, { kind: 'personal' });
}

/** Gabija accepts the invite, imports the Taimanov and notes 9...Ne5. */
async function playerImports(page: Page, link: string): Promise<string> {
  await page.goto(link);
  await expectInviteFrom(page, en, { coach: COACH });
  await acceptInvite(page, en);
  const t = en.repertoires;
  await page.goto('/repertoires/import');
  await previewImport(page, en, { file: TAIMANOV, side: 'black' });
  await page.getByLabel(t.import.name, { exact: true }).fill(REPERTOIRE);
  await page
    .getByRole('button', { name: t.import.confirm, exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(REPERTOIRE);
  await chooseChapter(page, TAIMANOV_B48);
  await ne5(page, en).click();
  await page.getByRole('button', { name: t.note.label }).click();
  await page
    .getByRole('textbox', { name: t.note.label, exact: true })
    .fill(PERSONAL_NOTE);
  await page.getByRole('button', { name: t.note.save }).click();
  await expect(page.getByText(t.note.saved)).toBeVisible();
  return page.url();
}

/**
 * From her repertoire page, on its Repertoire screen: ticks (or unticks)
 * Rimantas and saves; then back to the repertoire.
 */
async function setShared(
  page: Page,
  messages: Messages,
  shared: boolean,
): Promise<void> {
  await openRepertoireOptions(page, messages);
  const section = shareSection(page, messages);
  await section.getByRole('checkbox', { name: COACH }).setChecked(shared);
  await section
    .getByRole('button', { name: messages.share.save, exact: true })
    .click();
  await expect(
    section.getByText(
      shared
        ? plural(messages.share.sharedWith, { count: 1 })
        : messages.share.notShared,
      { exact: true },
    ),
  ).toBeVisible();
  await backToRepertoire(page, messages, REPERTOIRE);
}

/** Rimantas opens Gabija's page from his dashboard; returns its URL. */
async function openPlayer(coach: Page): Promise<string> {
  await coach.goto('/coach');
  await coach.getByRole('link', { name: PLAYER, exact: true }).click();
  await expect(coach).toHaveURL(/\/coach\/players\/[^/]+$/);
  return coach.url();
}

/**
 * Under "Bendrinami repertuarai" he opens the Taimanov: read-only, the
 * comment shows, no edit control and never Gabija's personal note.
 */
async function coachOpensShared(coach: Page): Promise<void> {
  const t = en.coach.shared;
  await coach
    .getByRole('region', { name: t.title })
    .getByRole('link', { name: new RegExp(`^${REPERTOIRE}`) })
    .click();
  await expect(coach).toHaveURL(/\/repertoires\/[0-9a-f-]{36}$/);
  await expect(coach.getByRole('heading', { level: 1 })).toHaveText(REPERTOIRE);
  await expect(coach.getByText(t.readOnly)).toBeVisible();
  await chooseChapter(coach, TAIMANOV_B48);
  await ne5(coach, en).click();
  await expect(coach.getByText(COMMENT)).toBeVisible();
  const r = en.repertoires;
  for (const control of [
    coach.getByRole('switch', { name: r.mode.build }),
    // No Repertoire screen for him: no More, so no Add from PGN or sharing.
    coach.getByRole('link', { name: r.more }),
    coach.getByRole('link', { name: r.manage.importInto }),
    coach.getByRole('button', { name: r.note.label }),
    coach.getByRole('textbox', { name: r.builder.commentLabel }),
    coach.getByRole('region', { name: en.share.title }),
  ])
    await expect(control).toHaveCount(0);
  // Checklist 2: not on the page, and not in the data it was sent.
  await expect(coach.getByText(PERSONAL_NOTE)).toHaveCount(0);
  expect(await coach.content()).not.toContain(PERSONAL_NOTE);
}

/** On 9...Ne5 he saves a coach note; the move gets the pen mark. */
async function coachWritesNote(coach: Page): Promise<void> {
  const t = en.coach.shared;
  await coach.getByLabel(t.note, { exact: true }).fill(COACH_NOTE);
  await coach.getByRole('button', { name: t.saveNote }).click();
  await expect(coach.getByText(t.noteSaved, { exact: true })).toBeVisible();
  const marked = ne5(coach, en, en.repertoires.moves.hasCoachNote);
  await expect(marked.locator('svg[data-note="coach"]')).toBeAttached();
  await coach.reload();
  await chooseChapter(coach, TAIMANOV_B48);
  await marked.click();
  await expect(coach.getByLabel(t.note, { exact: true })).toHaveValue(
    COACH_NOTE,
  );
}

/** On her 9...Ne5, Rimantas's note under his name, or none. */
async function expectCoachNote(page: Page, shown: boolean): Promise<void> {
  const messages = en;
  await page.reload();
  await chooseChapter(page, TAIMANOV_B48);
  await ne5(page, messages, messages.repertoires.moves.hasNote).click();
  await expect(page.getByText(PERSONAL_NOTE)).toBeVisible();
  const byCoach = page.getByText(
    format(messages.coachNote.byCoach, { name: COACH }),
  );
  await expect(byCoach).toHaveCount(shown ? 1 : 0);
  await expect(page.getByText(COACH_NOTE)).toHaveCount(shown ? 1 : 0);
}

/** The coach's page is the coach area's not-found page. */
async function expectNotFound(coach: Page): Promise<void> {
  await expect(coach.getByText(en.coach.notFound)).toBeVisible();
  await expect(coach.getByText(REPERTOIRE)).toHaveCount(0);
}

/** Gabija unlinks from Rimantas under "My coaches". */
async function playerUnlinks(page: Page, messages: Messages): Promise<void> {
  const t = messages.settings.myCoaches;
  await page.goto('/settings');
  await page.getByRole('button', { name: t.unlink }).click();
  await page.getByRole('button', { name: t.confirmUnlink }).click();
  await expect(page.getByText(t.empty)).toBeVisible();
}

/** A browser context of its own, closed when `run` ends. */
async function onOwnDevice(
  browser: Browser,
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const device = await newDevice(browser);
  try {
    await run(await device.newPage());
  } finally {
    await device.close();
  }
}

test(`G-M1-3: a shared repertoire, its coach note, and how unshare and unlink end them`, async ({
  page: coach,
  request,
  browser,
}) => {
  test.setTimeout(300_000);
  const messages = en;
  await newOnboardedAccount(coach, request, COACH);
  const link = await coachInvites(coach);

  await onOwnDevice(browser, async (gabija) => {
    await newOnboardedAccount(gabija, request, PLAYER);
    const repertoire = await playerImports(gabija, link);
    // Not shared yet: her page lists nothing for him (checklist 2).
    const player = await openPlayer(coach);
    const noneShared = coach.getByText(
      format(en.coach.shared.empty, { name: PLAYER }),
    );
    await expect(noneShared).toBeVisible();

    await setShared(gabija, messages, true);
    await coach.reload();
    await coachOpensShared(coach);
    const shared = coach.url();
    await coachWritesNote(coach);

    // R-107, R-127: she reads it, marked with his name.
    await expectCoachNote(gabija, true);

    // Unshared: his link is not found, and the note is gone (R-124).
    await setShared(gabija, messages, false);
    await coach.reload();
    await expectNotFound(coach);
    await coach.goto(player);
    await expect(noneShared).toBeVisible();
    await expectCoachNote(gabija, false);

    // Shared again: the old note does not come back.
    await setShared(gabija, messages, true);
    await coach.goto(shared);
    await chooseChapter(coach, TAIMANOV_B48);
    await ne5(coach, en).click();
    await expect(
      coach.getByLabel(en.coach.shared.note, { exact: true }),
    ).toHaveValue('');

    // Unlinked: access ends on his next request.
    await playerUnlinks(gabija, messages);
    await coach.reload();
    await expectNotFound(coach);
    await gabija.goto(repertoire);
    await expect(gabija.getByRole('heading', { level: 1 })).toHaveText(
      REPERTOIRE,
    );
    // No linked coach left: her Repertoire screen has no share section at
    // all (#331).
    await openRepertoireOptions(gabija, messages);
    await expect(
      gabija.getByRole('link', {
        name: en.repertoires.manage.download,
        exact: true,
      }),
    ).toBeVisible();
    await expect(shareSection(gabija, messages)).toHaveCount(0);
  });
});
