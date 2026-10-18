import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import RepertoiresLoading from './loading';
import RepertoiresPage from './page';

// requireOnboarded, inside the loader, never returns for a signed-out or
// new account; the feature suite covers that.
vi.mock('../../server/repertoires', () => ({
  myRepertoires: () =>
    Promise.resolve([
      {
        id: 'r-1',
        side: 'white',
        name: 'Londono sistema',
        chapters: 2,
        moves: 21,
        updatedAt: new Date('2026-10-18T08:00:00Z'),
      },
    ]),
}));

vi.mock('./actions', () => ({ createRepertoireAction: vi.fn() }));

const l = MESSAGES.lt.repertoires.list;

async function renderPage(params: Record<string, string> = {}): Promise<void> {
  render(
    <NextIntlClientProvider
      locale="lt"
      messages={MESSAGES.lt}
      timeZone="Europe/Vilnius"
    >
      {await RepertoiresPage({ searchParams: Promise.resolve(params) })}
    </NextIntlClientProvider>,
  );
}

describe('Mano repertuarai', () => {
  it('shows the title, the way home, the repertoires, the create form and the import link', async () => {
    await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: l.title }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: l.home }).getAttribute('href'),
    ).toBe('/');
    expect(
      screen
        .getByRole('link', { name: 'Londono sistema' })
        .getAttribute('href'),
    ).toBe('/repertuarai/r-1');
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: MESSAGES.lt.repertoires.create.title,
      }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: l.import }).getAttribute('href'),
    ).toBe('/repertuarai/importuoti');
    expect(
      screen.queryByText(MESSAGES.lt.repertoires.header.deleted),
    ).toBeNull();
  });

  it('says the repertoire was deleted after a delete', async () => {
    await renderPage({ deleted: '1' });
    expect(
      screen
        .getByText(MESSAGES.lt.repertoires.header.deleted)
        .getAttribute('role'),
    ).toBe('status');
  });

  it('shows the header and card skeletons while it loads', () => {
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        <RepertoiresLoading />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    expect(
      screen.getByRole('heading', { level: 1, name: l.title }),
    ).toBeDefined();
  });
});
