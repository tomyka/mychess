// #381 (plan Task 14, step 2): My repertoires' New, an empty repertoire's
// browse view, and the own Repertoire screen's Rename and Delete (R-226),
// as Gabija (docs/personas/1400-2000.md) and Rokas (docs/personas/u1400.md)
// meet them. Both run on a phone too: the form and the screen stack there.
import { expect, type Page } from '@playwright/test';
import { importRepertoire } from './support/assignments';
import { en, format, newOnboardedAccount, test } from './support/journey';
import {
  backToRepertoire,
  createRepertoire,
  openRepertoireOptions,
  openRepertoires,
} from './support/repertoires';
import { ITALIAN, ITALIAN_PGN } from './support/training-cast';

const t = en.repertoires;

/** My repertoires' New, which opens and closes the create form. */
const newButton = (page: Page) =>
  page.getByRole('button', { name: t.list.new, exact: true });

/** The create form's section under the header. */
const createForm = (page: Page) =>
  page.getByRole('region', { name: t.create.title, exact: true });

/** The Edit switch in the repertoire's top bar. */
const editSwitch = (page: Page) =>
  page.getByRole('switch', { name: t.mode.build, exact: true });

/** The top of `text`'s first box on the page. */
async function topOf(page: Page, text: string): Promise<number> {
  const box = await page.getByText(text, { exact: true }).boundingBox();
  if (box === null) throw new Error(`${text} is not laid out`);
  return box.y;
}

/**
 * An account with no repertoire: the empty line, then the form, open
 * already (New says so).
 */
async function expectEmptyList(page: Page): Promise<void> {
  await expect(page.getByText(t.list.empty, { exact: true })).toBeVisible();
  await expect(newButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(createForm(page)).toBeVisible();
  expect(await topOf(page, t.list.empty)).toBeLessThan(
    await topOf(page, t.create.title),
  );
}

/**
 * The new, empty repertoire `id` in browse mode: Add from PGN and Start
 * building, nothing to train; Start building switches Edit back on.
 */
async function expectEmptyBrowse(page: Page, id: string): Promise<void> {
  await editSwitch(page).click();
  await expect(editSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(
    page.getByText(t.panel.emptyBrowse, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: t.manage.importInto, exact: true }),
  ).toHaveAttribute('href', `/repertoires/import?i=${id}`);
  await expect(
    page.getByRole('region', { name: en.training.know.section }),
  ).toHaveCount(0);
  const train = /^(Review|Learn)\b/;
  await expect(page.getByRole('button', { name: train })).toHaveCount(0);
  await expect(page.getByRole('link', { name: train })).toHaveCount(0);
  await page.getByRole('button', { name: t.mode.toBuild, exact: true }).click();
  await expect(editSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.getByText(t.panel.emptyBuild, { exact: true }),
  ).toBeVisible();
}

/** The repertoire's id, from its page's URL. */
function idOf(page: Page): string {
  const id = /\/repertoires\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (id === undefined) throw new Error('no repertoire id in the URL');
  return id;
}

/** With a repertoire listed, New opens the form; Cancel closes it. */
async function newOpensAndCloses(page: Page): Promise<void> {
  await openRepertoires(page, en);
  await expect(page.getByText(t.list.empty, { exact: true })).toHaveCount(0);
  await expect(newButton(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(createForm(page)).toHaveCount(0);
  await newButton(page).click();
  await expect(newButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(createForm(page)).toBeVisible();
  await createForm(page)
    .getByRole('button', { name: t.list.cancel, exact: true })
    .click();
  await expect(createForm(page)).toHaveCount(0);
  await expect(newButton(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(newButton(page)).toBeFocused();
  await newButton(page).click();
  await expect(createForm(page)).toBeVisible();
}

test(
  '#381: My repertoires opens the create form for an empty account and on New; a new repertoire opens in Edit, and its browse view offers Add from PGN and Start building',
  { tag: '@mobile' },
  async ({ page, request }) => {
    test.setTimeout(120_000);
    await newOnboardedAccount(page, request, 'Gabija Navickaitė');
    await openRepertoires(page, en);
    await expectEmptyList(page);
    await createRepertoire(page, en, { name: 'Najdorfas', side: 'black' });
    const first = idOf(page);
    await expectEmptyBrowse(page, first);

    await newOpensAndCloses(page);
    await createRepertoire(page, en, { name: 'Karo-Kan', side: 'black' });
    expect(idOf(page)).not.toBe(first);
    await openRepertoires(page, en);
    for (const name of ['Najdorfas', 'Karo-Kan'])
      await expect(
        page.getByRole('link', { name: new RegExp(`^${name}`) }),
      ).toBeVisible();
  },
);

/** Renames the repertoire in place on its Repertoire screen. */
async function rename(page: Page, name: string): Promise<void> {
  const h = t.manage;
  await page.getByRole('button', { name: h.rename, exact: true }).click();
  const field = page.getByLabel(h.renameLabel, { exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(ITALIAN);
  await field.fill(name);
  await page.getByRole('button', { name: h.renameSubmit, exact: true }).click();
  await expect(page.getByText(h.renamed, { exact: true })).toBeVisible();
  await expect(field).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

/** Delete asks first; Keep is Cancel, then Delete permanently. */
async function deleteIt(page: Page, name: string): Promise<void> {
  const h = t.manage;
  const danger = page.getByRole('region', {
    name: t.manage.deleteTitle,
    exact: true,
  });
  const remove = danger.getByRole('button', { name: h.delete, exact: true });
  const question = danger.getByText(format(h.deleteQuestion, { name }));
  await remove.click();
  await expect(question).toBeVisible();
  const cancel = danger.getByRole('button', {
    name: h.deleteCancel,
    exact: true,
  });
  await expect(cancel).toBeFocused();
  await cancel.click();
  await expect(question).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await danger
    .getByRole('button', { name: h.deleteConfirm, exact: true })
    .click();
}

test(
  '#381, R-226: the Repertoire screen renames the repertoire in place, and deletes it behind a two-step confirm',
  { tag: '@mobile' },
  async ({ page, request }) => {
    test.setTimeout(120_000);
    await newOnboardedAccount(page, request, 'Rokas Petrauskas');
    const url = await importRepertoire(page, en, {
      file: ITALIAN_PGN,
      side: 'white',
      name: ITALIAN,
    });
    const renamed = 'Itališkoji: Giuoco Pianissimo';
    await openRepertoireOptions(page, en);
    await rename(page, renamed);
    await backToRepertoire(page, en, renamed);
    await openRepertoires(page, en);
    await expect(
      page.getByRole('link', { name: new RegExp(`^${renamed}`) }),
    ).toBeVisible();

    await page.goto(url);
    await openRepertoireOptions(page, en);
    await deleteIt(page, renamed);
    await expect(page).toHaveURL(/\/repertoires\?deleted=1$/);
    await expect(
      page.getByText(t.manage.deleted, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: new RegExp(`^${renamed}`) }),
    ).toHaveCount(0);
    const gone = await page.goto(url);
    expect(gone?.status()).toBe(404);
  },
);
