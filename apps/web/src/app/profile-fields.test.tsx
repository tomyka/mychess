import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n/locales';
import { LanguageField } from './profile-fields';

const { en } = MESSAGES;

function renderField(
  offered: readonly ('lt' | 'en')[],
  initial: 'lt' | 'en',
): HTMLFormElement {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <form>
        <LanguageField legend="Language" initial={initial} offered={offered} />
      </form>
    </NextIntlClientProvider>,
  );
  const form = container.querySelector('form');
  if (form === null) throw new Error('the field sits in a form');
  return form;
}

const option = (name: string) =>
  screen.getByRole<HTMLInputElement>('radio', { name });

describe('LanguageField', () => {
  it('with one language offered asks nothing and keeps the stored one (R-180)', () => {
    const form = renderField(['en'], 'lt');
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(new FormData(form).get('locale')).toBe('lt');
  });

  it('with more offered names each in its own language, the stored one chosen', () => {
    const form = renderField(['lt', 'en'], 'lt');
    expect(screen.getByRole('group', { name: 'Language' })).toBeDefined();
    expect(option('Lietuvių').checked).toBe(true);
    expect(option('English').checked).toBe(false);
    expect(new FormData(form).get('locale')).toBe('lt');
  });
});
