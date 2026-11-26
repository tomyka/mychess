import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { ShellProvider } from '../shell/shell-context';
import { RepertoireTopBar } from './top-bar';

const NAME = 'Sicilian Najdorf: the English Attack and the Poisoned Pawn';

/** The bar on a signed-in page, where the shell knows the account. */
function renderBar(extra: {
  readonly edit?: ReactNode;
  readonly moreHref?: string;
}): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ShellProvider
        value={{
          accountId: 'a1',
          displayName: 'Gabija Navickaitė',
          theme: 'system',
        }}
      >
        <RepertoireTopBar
          back={{ href: '/repertoires', parent: 'Repertoires' }}
          name={NAME}
          {...extra}
        />
      </ShellProvider>
    </NextIntlClientProvider>,
  );
}

describe('RepertoireTopBar (spec, Header)', () => {
  it('has the way back, the name, Edit and More', () => {
    renderBar({
      edit: <button type="button">Edit</button>,
      moreHref: '/repertoires/r-1/manage',
    });
    expect(
      screen
        .getByRole('link', { name: 'Back to Repertoires' })
        .getAttribute('href'),
    ).toBe('/repertoires');
    expect(screen.getByRole('heading', { level: 1, name: NAME })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: MESSAGES.repertoires.more })
        .getAttribute('href'),
    ).toBe('/repertoires/r-1/manage');
  });

  it('never clamps the name: its end is what tells two repertoires apart (sign-off)', () => {
    renderBar({});
    const name = screen.getByRole('heading', { level: 1, name: NAME });
    expect(name.textContent).toBe(NAME);
    expect(name.className).not.toMatch(/line-clamp|truncate/);
    expect(name.className).toContain('break-words');
    // 16px on 20px lines: two lines fit the 44px row (spec, Long names).
    expect(name.className).toContain('text-base/5');
  });

  it('gives the row to the name: no account menu in it (one tab away, spec)', () => {
    renderBar({
      edit: <button type="button">Edit</button>,
      moreHref: '/repertoires/r-1/manage',
    });
    expect(
      screen.queryByRole('button', { name: MESSAGES.nav.account.open }),
    ).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('is one row on a phone; on a desktop the name has its own full-width row under back, Edit and More', () => {
    renderBar({
      edit: <button type="button">Edit</button>,
      moreHref: '/repertoires/r-1/manage',
    });
    const name = screen.getByRole('heading', { level: 1, name: NAME });
    const bar = name.parentElement;
    expect(bar?.tagName).toBe('HEADER');
    expect(bar?.className).toContain('lg:flex-wrap');
    expect(name.className).toContain('lg:order-last');
    expect(name.className).toContain('lg:basis-full');
  });

  it('has only the way back and the name where the viewer has no Repertoire screen', () => {
    renderBar({});
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: NAME })).toBeDefined();
  });
});
