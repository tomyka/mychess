import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { RepertoireTopBar } from './top-bar';

const NAME = 'Sicilian Najdorf: the English Attack and the Poisoned Pawn';

function renderBar(extra: {
  readonly edit?: ReactNode;
  readonly moreHref?: string;
  readonly children?: ReactNode;
}): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <RepertoireTopBar
        back={{ href: '/repertoires', parent: 'Repertoires' }}
        name={NAME}
        {...extra}
      />
    </NextIntlClientProvider>,
  );
}

describe('RepertoireTopBar (spec, Header)', () => {
  it('has the way back, the name on up to two lines, Edit and More', () => {
    renderBar({
      edit: <button type="button">Edit</button>,
      moreHref: '/repertoires/r-1/manage',
      children: <p>Black · 6 chapters</p>,
    });
    expect(
      screen
        .getByRole('link', { name: 'Back to Repertoires' })
        .getAttribute('href'),
    ).toBe('/repertoires');
    const name = screen.getByRole('heading', { level: 1, name: NAME });
    // Finding 5: never a one-line clamp; the full name in the title.
    expect(name.className).toContain('line-clamp-2');
    expect(name.className).not.toContain('truncate');
    expect(name.getAttribute('title')).toBe(NAME);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: MESSAGES.repertoires.more })
        .getAttribute('href'),
    ).toBe('/repertoires/r-1/manage');
    expect(screen.getByText('Black · 6 chapters')).toBeDefined();
  });

  it('has only the way back and the name where the viewer has no Repertoire screen', () => {
    renderBar({});
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: NAME })).toBeDefined();
  });
});
