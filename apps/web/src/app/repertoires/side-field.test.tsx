import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { SideField } from './side-field';

const c = MESSAGES.repertoires.create;

/** The class names of the card around the radio named `name`. */
const cardClasses = (name: string): readonly string[] =>
  (screen.getByRole('radio', { name }).closest('label')?.className ?? '').split(
    ' ',
  );

describe('SideField', () => {
  it('tints the chosen card accent-subtle with an accent ring, in both themes (#381 dark finding 15)', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <SideField />
      </NextIntlClientProvider>,
    );
    const card = cardClasses(c.white);
    expect(card).toEqual(
      expect.arrayContaining([
        'has-checked:bg-accent-subtle',
        'has-checked:ring-1',
        'has-checked:ring-accent',
        'has-checked:border-accent',
      ]),
    );
    expect(card).not.toContain('has-checked:bg-sunken');
    expect(card.filter((name) => name.includes('dark:'))).toEqual([]);
    expect(cardClasses(c.black)).toEqual(card);
  });
});
