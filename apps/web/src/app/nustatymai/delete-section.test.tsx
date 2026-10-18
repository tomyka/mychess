import type { DeletableAccount } from '@mychess/domain';
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

const ONBOARDED: DeletableAccount = {
  displayName: 'Rūta Jonaitė',
  email: 'ruta@example.lt',
  onboardedAt: new Date('2026-10-16T08:00:00Z'),
};

// Not yet through onboarding: the Google name is only a prefill (R-86).
const FRESH: DeletableAccount = {
  displayName: 'Ruta J',
  email: 'ruta@example.lt',
  onboardedAt: null,
};

function renderSection(
  locale: 'lt' | 'en' = 'lt',
  account: DeletableAccount = ONBOARDED,
  canExport = true,
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <DeleteSection account={account} canExport={canExport} />
    </NextIntlClientProvider>,
  );
}

// The label as it reads: the catalogue text with the value filled in and
// its <strong> tag dropped.
const field = (label: string, key: string, value: string) =>
  screen.getByLabelText<HTMLInputElement>(
    label.replace(`<strong>{${key}}</strong>`, value),
  );
const typedName = () => field(d.typeName, 'name', 'Rūta Jonaitė');
const typedEmail = () => field(d.typeEmail, 'email', 'ruta@example.lt');
const confirm = () => screen.getByRole('button', { name: d.confirm });
const type = (value: string, input = typedName()) => {
  fireEvent.change(input, { target: { value } });
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
      d.items.repertoires,
      d.items.sessions,
    ]);
    expect(d.items.repertoires).toBe(
      'repertuarai, jų skyriai, ėjimai, komentarai ir asmeninės pastabos;',
    );
    expect(screen.getByText(d.irreversible)).toBeDefined();
    const link = screen.getByRole('link', {
      name: 'atsisiųskite savo duomenis',
    });
    expect(link.getAttribute('href')).toBe('/api/account/export');
    expect(link.hasAttribute('download')).toBe(true);
    expect(screen.queryByRole('note')).toBeNull();
    expect(status().textContent).toBe('');
  });

  it('asks a session older than a day to sign in again instead of linking the export (R-95)', () => {
    renderSection('lt', ONBOARDED, false);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/atsisiųskite savo duomenis/u)).toBeNull();
    expect(screen.getByRole('note').textContent).toBe(
      lt.settings.export.notFresh,
    );
    expect(screen.getByText(d.irreversible)).toBeDefined();
  });

  it('shows the display name to type in bold', () => {
    renderSection();
    expect(
      screen.getByText('Rūta Jonaitė', { selector: 'label strong' }),
    ).toBeDefined();
  });

  it('keeps the button disabled until the display name is typed', () => {
    renderSection();
    expect(confirm().hasAttribute('disabled')).toBe(true);
    type('Rūta');
    expect(confirm().hasAttribute('disabled')).toBe(true);
    type('rūta jonaitė');
    expect(confirm().hasAttribute('disabled')).toBe(true);
    type('ruta@example.lt');
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
      confirmation: 'Rūta Jonaitė',
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

  // The action is settled at the end: React entangles async transitions,
  // so one left pending would hold back every later test's.
  it('cannot send twice while deleting', async () => {
    let settle: (state: DeleteState) => void = () => undefined;
    server.action.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderSection();
    type('Rūta Jonaitė');
    fireEvent.click(confirm());
    await waitFor(() => {
      expect(confirm().hasAttribute('disabled')).toBe(true);
    });
    settle({});
  });

  it('speaks English on the English page', () => {
    renderSection('en');
    const e = MESSAGES.en.settings.delete;
    expect(screen.getByRole('button', { name: e.confirm })).toBeDefined();
    expect(screen.getByText(e.items.repertoires)).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'download your data' }),
    ).toBeDefined();
  });
});

describe('DeleteSection for an account not yet onboarded (R-86)', () => {
  it('asks for the email address, shown in bold, not the prefilled name', () => {
    renderSection('lt', FRESH);
    expect(
      screen.getByText('ruta@example.lt', { selector: 'label strong' }),
    ).toBeDefined();
    expect(typedEmail().getAttribute('type')).toBe('email');
    expect(screen.queryByText('Ruta J')).toBeNull();
  });

  it('keeps the button disabled until the email is typed, in any case', () => {
    renderSection('lt', FRESH);
    type('Ruta J', typedEmail());
    expect(confirm().hasAttribute('disabled')).toBe(true);
    type('jonas@example.lt', typedEmail());
    expect(confirm().hasAttribute('disabled')).toBe(true);
    type(' Ruta@Example.LT ', typedEmail());
    expect(confirm().hasAttribute('disabled')).toBe(false);
  });

  it('sends the typed email and shows the server’s refusal', async () => {
    server.action.mockResolvedValue({ refusal: 'account.deleteEmailMismatch' });
    renderSection('lt', FRESH);
    type('ruta@example.lt', typedEmail());
    fireEvent.click(confirm());
    await waitFor(() => {
      expect(status().textContent).toBe(lt.account.deleteEmailMismatch);
    });
    const form = server.action.mock.lastCall?.[1];
    expect(Object.fromEntries(form?.entries() ?? [])).toEqual({
      confirmation: 'ruta@example.lt',
    });
  });
});
