import type { Account } from '@mychess/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import type { DeleteState } from './actions';
import { DeleteSection } from './delete-section';

const server = vi.hoisted(() => ({
  action:
    vi.fn<(previous: DeleteState, form: FormData) => Promise<DeleteState>>(),
}));

vi.mock('./actions', () => ({ deleteAccountAction: server.action }));

const lt = MESSAGES.lt;
const d = lt.settings.delete;

const ACCOUNT: Account = {
  id: 'a1',
  email: 'ruta@example.lt',
  displayName: 'Rūta Jonaitė',
  locale: 'lt',
  entitlement: 'free',
  admin: false,
  disabledAt: null,
  onboardedAt: new Date('2026-10-01T10:00:00Z'),
  createdAt: new Date('2026-10-01T09:00:00Z'),
};

function renderSection(locale: 'lt' | 'en' = 'lt'): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <DeleteSection account={ACCOUNT} />
    </NextIntlClientProvider>,
  );
}

const typedName = () =>
  screen.getByLabelText<HTMLInputElement>(
    d.typeName.replace('{name}', 'Rūta Jonaitė'),
  );
const confirm = () => screen.getByRole('button', { name: d.confirm });
const type = (value: string) => {
  fireEvent.change(typedName(), { target: { value } });
};
const status = () => screen.getByRole('status');

beforeEach(() => {
  server.action.mockReset().mockResolvedValue({});
});

describe('DeleteSection (R-82)', () => {
  it('says what will be deleted and offers the export first', () => {
    renderSection();
    expect(
      screen.getByRole('heading', { level: 2, name: d.title }),
    ).toBeDefined();
    expect(screen.getByText(d.whatGoes)).toBeDefined();
    const items = screen.getAllByRole('listitem').map((i) => i.textContent);
    expect(items).toEqual([
      d.items.account,
      d.items.providers,
      d.items.sessions,
    ]);
    expect(screen.getByText(d.irreversible)).toBeDefined();
    const link = screen.getByRole('link', {
      name: 'atsisiųskite savo duomenis',
    });
    expect(link.getAttribute('href')).toBe('/api/account/export');
    expect(status().textContent).toBe('');
  });

  it('keeps the button disabled until the display name is typed', () => {
    renderSection();
    expect(confirm().hasAttribute('disabled')).toBe(true);
    type('Rūta');
    expect(confirm().hasAttribute('disabled')).toBe(true);
    type('rūta jonaitė');
    expect(confirm().hasAttribute('disabled')).toBe(true);
    type(' Rūta Jonaitė ');
    expect(confirm().hasAttribute('disabled')).toBe(false);
    type('Rūta Jonaitė!');
    expect(confirm().hasAttribute('disabled')).toBe(true);
  });

  it('sends the typed name', async () => {
    renderSection();
    type('Rūta Jonaitė');
    fireEvent.click(confirm());
    await waitFor(() => {
      expect(server.action).toHaveBeenCalledTimes(1);
    });
    const form = server.action.mock.lastCall?.[1];
    expect(Object.fromEntries(form?.entries() ?? [])).toEqual({
      typedName: 'Rūta Jonaitė',
    });
  });

  it('shows the server’s refusal and keeps the typed name', async () => {
    server.action.mockResolvedValue({ refusal: 'account.deleteNameMismatch' });
    renderSection();
    type('Rūta Jonaitė');
    fireEvent.click(confirm());
    await waitFor(() => {
      expect(status().textContent).toBe(lt.account.deleteNameMismatch);
    });
    expect(typedName().value).toBe('Rūta Jonaitė');
    expect(typedName().getAttribute('aria-invalid')).toBe('true');
  });

  it('cannot send twice while deleting', async () => {
    server.action.mockReturnValue(new Promise(() => undefined));
    renderSection();
    type('Rūta Jonaitė');
    fireEvent.click(confirm());
    await waitFor(() => {
      expect(confirm().hasAttribute('disabled')).toBe(true);
    });
  });

  it('speaks English on the English page', () => {
    renderSection('en');
    const e = MESSAGES.en.settings.delete;
    expect(screen.getByRole('button', { name: e.confirm })).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'download your data' }),
    ).toBeDefined();
  });
});
