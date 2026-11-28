import type { DeletableAccount } from '@mychess/domain';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import { DeleteAccountControl } from './delete-account-control';
import type { DeleteState } from './settings/actions';

const server = vi.hoisted(() => ({
  action:
    vi.fn<(previous: DeleteState, form: FormData) => Promise<DeleteState>>(),
}));

vi.mock('./settings/actions', () => ({ deleteAccountAction: server.action }));

const d = MESSAGES.settings.delete;

const ACCOUNT: DeletableAccount = {
  displayName: 'Rūta Jonaitė',
  email: 'ruta@example.lt',
  onboardedAt: new Date('2026-10-16T08:00:00Z'),
};

// Welcome's account: not yet through onboarding, so it confirms by email (R-86).
const FRESH: DeletableAccount = {
  displayName: 'Ruta J',
  email: 'ruta@example.lt',
  onboardedAt: null,
};

beforeEach(() => {
  server.action.mockReset().mockResolvedValue({});
});

function renderControl(
  variant: 'row' | 'link',
  canExport = true,
  account: DeletableAccount = ACCOUNT,
): HTMLElement {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <DeleteAccountControl
        account={account}
        canExport={canExport}
        variant={variant}
      />
    </NextIntlClientProvider>,
  );
  return screen.getByRole('button', { name: d.open });
}

/** Opens the sheet from a focused button; the dialog. */
function open(button: HTMLElement): HTMLElement {
  button.focus();
  fireEvent.click(button);
  return screen.getByRole('dialog', { name: d.title });
}

describe('DeleteAccountControl (#381 part 6)', () => {
  it('shows only its button until pressed', () => {
    renderControl('row');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: d.confirm })).toBeNull();
  });

  it("opens a dialog named Delete account holding today's form", () => {
    const dialog = open(renderControl('row'));
    expect(
      within(dialog).getByRole('heading', { level: 2, name: d.title }),
    ).toBeDefined();
    expect(within(dialog).getByText(d.whatGoes)).toBeDefined();
    expect(
      within(dialog).getByText('Rūta Jonaitė', { selector: 'label strong' }),
    ).toBeDefined();
    expect(
      within(dialog)
        .getByRole('link', { name: 'download your data' })
        .getAttribute('href'),
    ).toBe('/api/account/export');
    expect(
      within(dialog)
        .getByRole('button', { name: d.confirm })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('asks a session older than a day to sign in again first (R-95)', () => {
    const dialog = open(renderControl('link', false));
    expect(within(dialog).getByRole('note').textContent).toBe(
      MESSAGES.settings.export.notFresh,
    );
  });

  it('closes on Cancel, focus back on the button', () => {
    const button = renderControl('link');
    const dialog = open(button);
    fireEvent.click(within(dialog).getByRole('button', { name: d.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes on Escape, focus back on the button', () => {
    const button = renderControl('row');
    const dialog = open(button);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  // Safari does not focus a clicked button: focus still goes back to it.
  it('returns focus to the button even when pressing it did not focus it', () => {
    const button = renderControl('link');
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: d.title });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(document.activeElement).toBe(button);
  });

  it("refuses a wrong confirmation inside the sheet, and shows the server's refusal there", async () => {
    server.action.mockResolvedValue({ refusal: 'account.deleteEmailMismatch' });
    const dialog = open(renderControl('link', true, FRESH));
    const email = within(dialog).getByLabelText<HTMLInputElement>(
      d.typeEmail.replace('<strong>{email}</strong>', 'ruta@example.lt'),
    );
    const confirm = within(dialog).getByRole('button', { name: d.confirm });
    fireEvent.change(email, { target: { value: 'jonas@example.lt' } });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(email, { target: { value: 'ruta@example.lt' } });
    expect(confirm.hasAttribute('disabled')).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(within(dialog).getByRole('status').textContent).toBe(
        MESSAGES.account.deleteEmailMismatch,
      );
    });
    expect(server.action).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: d.title })).toBe(dialog);
    expect(email.value).toBe('ruta@example.lt');
  });

  // The look is the variant's behaviour: an error-tone row in Settings, a
  // quiet link under welcome's card.
  it('is an error-tone full row in Settings', () => {
    const row = renderControl('row').className.split(' ');
    expect(row).toEqual(expect.arrayContaining(['w-full', 'text-error']));
  });

  it('is a quiet underlined link under welcome', () => {
    const link = renderControl('link').className.split(' ');
    expect(link).toEqual(
      expect.arrayContaining(['underline', 'text-fg-muted']),
    );
    expect(link).not.toContain('text-error');
  });
});
