// S4 journey G-M1-3 (plan Task B8): Gabija shares her Taimanov with her
// coach Rimantas, who reads it read-only and writes a coach note; she reads
// the note under his name; unsharing and unlinking each end his access and
// take his notes with them (R-42, R-107, R-124, R-125, R-127). Rimantas
// works in Lithuanian; Gabija once in Lithuanian and once in English.
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
  CATALOGUES,
  chooseEnglish,
  format,
  newDevice,
  newOnboardedAccount,
  test,
  type Locale,
  type Messages,
} from './support/journey';
import {
  chip,
  chooseChapter,
  plural,
  previewImport,
} from './support/repertoires';

const { lt } = CATALOGUES;

const COACH = 'Rimantas Vaitkus';
const PLAYER = 'Gabija Navickaitė';
const REPERTOIRE = 'Taimanovas';

/** Gabija's six Taimanov lines (and one broken game the import skips). */
const TAIMANOV = fileURLToPath(
  new URL('fixtures/taimanov.pgn', import.meta.url),
);
/**
 * The first chapter (6.Be3), whose 9...Ne5 carries the comment below, by
 * its opening name in each language (opening names follow the language).
 */
const FIRST_CHAPTER: Record<Locale, string> = {
  lt: 'Siciliška gynyba, Taimanovo variantas',
  en: 'Sicilian Defense: Taimanov Variation, Bastrikov Variation, English Attack',
};
/** Rimantas reads in Lithuanian. */
const TAIMANOV_B48 = FIRST_CHAPTER.lt;
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

/** The "Share with a coach" section of Gabija's repertoire page. */
const shareSection = (page: Page, messages: Messages): Locator =>
  page.getByRole('region', { name: messages.share.title });

/** Rimantas: Coach mode on, a personal invite; returns its link. */
async function coachInvites(page: Page): Promise<string> {
  await switchOnCoachMode(page, lt);
  await page.goto('/treneris');
  return createInvite(page, lt, { kind: 'personal' });
}

/** Gabija accepts the invite, imports the Taimanov and notes 9...Ne5. */
async function playerImports(page: Page, link: string): Promise<string> {
  await page.goto(link);
  await expectInviteFrom(page, lt, { coach: COACH });
  await acceptInvite(page, lt);
  const t = lt.repertoires;
  await page.goto('/repertuarai/importuoti');
  await previewImport(page, lt, { file: TAIMANOV, side: 'black' });
  await page.getByLabel(t.import.name, { exact: true }).fill(REPERTOIRE);
  await page
    .getByRole('button', { name: t.import.confirm, exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(REPERTOIRE);
  await chooseChapter(page, TAIMANOV_B48);
  await ne5(page, lt).click();
  await page.getByRole('button', { name: t.note.label }).click();
  await page
    .getByRole('textbox', { name: t.note.label, exact: true })
    .fill(PERSONAL_NOTE);
  await page.getByRole('button', { name: t.note.save }).click();
  await expect(page.getByText(t.note.saved)).toBeVisible();
  return page.url();
}

/** On her repertoire page: ticks (or unticks) Rimantas and saves. */
async function setShared(
  page: Page,
  messages: Messages,
  locale: Locale,
  shared: boolean,
): Promise<void> {
  const section = shareSection(page, messages);
  await section.getByRole('checkbox', { name: COACH }).setChecked(shared);
  await section
    .getByRole('button', { name: messages.share.save, exact: true })
    .click();
  await expect(
    section.getByText(
      shared
        ? plural(messages.share.sharedWith, locale, { count: 1 })
        : messages.share.notShared,
      { exact: true },
    ),
  ).toBeVisible();
}

/** Rimantas opens Gabija's page from his dashboard; returns its URL. */
async function openPlayer(coach: Page): Promise<string> {
  await coach.goto('/treneris');
  await coach.getByRole('link', { name: PLAYER, exact: true }).click();
  await expect(coach).toHaveURL(/\/treneris\/zaidejai\/[^/]+$/);
  return coach.url();
}

/**
 * Under "Bendrinami repertuarai" he opens the Taimanov: read-only, the
 * comment shows, no edit control and never Gabija's personal note.
 */
async function coachOpensShared(coach: Page): Promise<void> {
  const t = lt.coach.shared;
  await coach
    .getByRole('region', { name: t.title })
    .getByRole('link', { name: new RegExp(`^${REPERTOIRE}`) })
    .click();
  await expect(coach).toHaveURL(/\/repertuarai\/[0-9a-f-]{36}$/);
  await expect(coach.getByRole('heading', { level: 1 })).toHaveText(REPERTOIRE);
  await expect(coach.getByText(t.readOnly)).toBeVisible();
  await chooseChapter(coach, TAIMANOV_B48);
  await ne5(coach, lt).click();
  await expect(coach.getByText(COMMENT)).toBeVisible();
  const r = lt.repertoires;
  for (const control of [
    coach.getByRole('switch', { name: r.mode.build }),
    coach.getByRole('link', { name: r.header.importInto }),
    coach.getByRole('button', { name: r.note.label }),
    coach.getByRole('textbox', { name: r.builder.commentLabel }),
    coach.getByRole('region', { name: lt.share.title }),
  ])
    await expect(control).toHaveCount(0);
  // Checklist 2: not on the page, and not in the data it was sent.
  await expect(coach.getByText(PERSONAL_NOTE)).toHaveCount(0);
  expect(await coach.content()).not.toContain(PERSONAL_NOTE);
}

/** On 9...Ne5 he saves a coach note; the move gets the pen mark. */
async function coachWritesNote(coach: Page): Promise<void> {
  const t = lt.coach.shared;
  await coach.getByLabel(t.note, { exact: true }).fill(COACH_NOTE);
  await coach.getByRole('button', { name: t.saveNote }).click();
  await expect(coach.getByText(t.noteSaved, { exact: true })).toBeVisible();
  const marked = ne5(coach, lt, lt.repertoires.moves.hasCoachNote);
  await expect(marked.locator('svg[data-note="coach"]')).toBeAttached();
  await coach.reload();
  await chooseChapter(coach, TAIMANOV_B48);
  await marked.click();
  await expect(coach.getByLabel(t.note, { exact: true })).toHaveValue(
    COACH_NOTE,
  );
}

/** On her 9...Ne5, Rimantas's note under his name, or none. */
async function expectCoachNote(
  page: Page,
  locale: Locale,
  shown: boolean,
): Promise<void> {
  const messages = CATALOGUES[locale];
  await page.reload();
  await chooseChapter(page, FIRST_CHAPTER[locale]);
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
  await expect(coach.getByText(lt.coach.notFound)).toBeVisible();
  await expect(coach.getByText(REPERTOIRE)).toHaveCount(0);
}

/** Gabija unlinks from Rimantas under "My coaches". */
async function playerUnlinks(page: Page, messages: Messages): Promise<void> {
  const t = messages.settings.myCoaches;
  await page.goto('/nustatymai');
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

for (const locale of ['lt', 'en'] as const) {
  test(`G-M1-3 (Gabija in ${locale}): a shared repertoire, its coach note, and how unshare and unlink end them`, async ({
    page: coach,
    request,
    browser,
  }) => {
    test.setTimeout(300_000);
    const messages = CATALOGUES[locale];
    await newOnboardedAccount(coach, request, COACH);
    const link = await coachInvites(coach);

    await onOwnDevice(browser, async (gabija) => {
      await newOnboardedAccount(gabija, request, PLAYER);
      const repertoire = await playerImports(gabija, link);
      if (locale === 'en') {
        await gabija.goto('/');
        await chooseEnglish(gabija);
        await gabija.goto(repertoire);
      }
      // Not shared yet: her page lists nothing for him (checklist 2).
      const player = await openPlayer(coach);
      const noneShared = coach.getByText(
        format(lt.coach.shared.empty, { name: PLAYER }),
      );
      await expect(noneShared).toBeVisible();

      await setShared(gabija, messages, locale, true);
      await coach.reload();
      await coachOpensShared(coach);
      const shared = coach.url();
      await coachWritesNote(coach);

      // R-107, R-127: she reads it, marked with his name.
      await expectCoachNote(gabija, locale, true);

      // Unshared: his link is not found, and the note is gone (R-124).
      await setShared(gabija, messages, locale, false);
      await coach.reload();
      await expectNotFound(coach);
      await coach.goto(player);
      await expect(noneShared).toBeVisible();
      await expectCoachNote(gabija, locale, false);

      // Shared again: the old note does not come back.
      await setShared(gabija, messages, locale, true);
      await coach.goto(shared);
      await chooseChapter(coach, TAIMANOV_B48);
      await ne5(coach, lt).click();
      await expect(
        coach.getByLabel(lt.coach.shared.note, { exact: true }),
      ).toHaveValue('');

      // Unlinked: access ends on his next request.
      await playerUnlinks(gabija, messages);
      await coach.reload();
      await expectNotFound(coach);
      await gabija.goto(repertoire);
      await expect(
        shareSection(gabija, messages).getByText(messages.share.noCoach),
      ).toBeVisible();
    });
  });
}
