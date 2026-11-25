// The app shell as a person uses it (#381): the tabs and the account menu.
import type { Locator, Page } from '@playwright/test';
import type { Messages } from './journey';

type Tab = 'today' | 'repertoires' | 'opponents' | 'coach';

/** The main navigation (bottom bar on a phone, top bar on desktop). */
export const mainNav = (page: Page, messages: Messages): Locator =>
  page.getByRole('navigation', { name: messages.nav.label });

/** Opens a tab. Today's name may carry the due count, so it is a prefix. */
export async function openTab(
  page: Page,
  messages: Messages,
  tab: Tab,
): Promise<void> {
  await mainNav(page, messages)
    .getByRole('link', { name: messages.nav[tab] })
    .click();
}

/** Opens the account menu and follows one of its items. */
export async function fromAccountMenu(
  page: Page,
  messages: Messages,
  item: 'settings' | 'myCoaches' | 'signOut',
): Promise<void> {
  await page.getByRole('button', { name: messages.nav.account.open }).click();
  if (item === 'signOut')
    await page.getByRole('button', { name: messages.app.signOut }).click();
  else
    await page.getByRole('link', { name: messages.nav.account[item] }).click();
}
