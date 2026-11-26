import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { NewRepertoire } from './new-repertoire';

vi.mock('./actions', () => ({ createRepertoireAction: vi.fn() }));

const l = MESSAGES.repertoires.list;
const c = MESSAGES.repertoires.create;

function renderHeader(startOpen: boolean): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <NewRepertoire startOpen={startOpen} />
    </NextIntlClientProvider>,
  );
}

const newButton = () => screen.getByRole('button', { name: l.new });
const nameField = () => screen.queryByLabelText(c.name);

describe('NewRepertoire (spec "My repertoires")', () => {
  it('heads the page with its title, Import PGN and New, the form closed', () => {
    renderHeader(false);
    expect(
      screen.getByRole('heading', { level: 1, name: l.title }),
    ).toBeDefined();
    expect(screen.getByText(l.intro)).toBeDefined();
    expect(
      screen.getByRole('link', { name: l.import }).getAttribute('href'),
    ).toBe('/repertoires/import');
    expect(newButton().getAttribute('aria-expanded')).toBe('false');
    expect(nameField()).toBeNull();
  });

  it('opens the create form under the header with its fields', () => {
    renderHeader(false);
    fireEvent.click(newButton());
    expect(newButton().getAttribute('aria-expanded')).toBe('true');
    const form = screen.getByRole('region', { name: c.title });
    expect(newButton().getAttribute('aria-controls')).toBe(form.id);
    expect(nameField()).not.toBeNull();
    expect(screen.getByRole('radio', { name: c.white })).toBeDefined();
    expect(screen.getByRole('button', { name: c.submit })).toBeDefined();
  });

  it('closes on Cancel and gives the focus back to New', () => {
    renderHeader(false);
    fireEvent.click(newButton());
    fireEvent.click(screen.getByRole('button', { name: l.cancel }));
    expect(nameField()).toBeNull();
    expect(newButton().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(newButton());
  });

  it('starts open for an account with no repertoire at all', () => {
    renderHeader(true);
    expect(newButton().getAttribute('aria-expanded')).toBe('true');
    expect(nameField()).not.toBeNull();
  });
});
