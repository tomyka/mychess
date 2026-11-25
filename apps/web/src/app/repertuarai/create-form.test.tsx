import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { CreateState } from './actions';
import { CreateForm } from './create-form';

const server = vi.hoisted(() => ({
  create:
    vi.fn<(previous: CreateState, form: FormData) => Promise<CreateState>>(),
}));

vi.mock('./actions', () => ({ createRepertoireAction: server.create }));

const c = MESSAGES.repertoires.create;

function renderForm(): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <CreateForm />
    </NextIntlClientProvider>,
  );
}

const nameField = () => screen.getByLabelText<HTMLInputElement>(c.name);

beforeEach(() => {
  server.create.mockReset().mockResolvedValue({});
});

describe('CreateForm', () => {
  it('sends the name and the chosen side, White by default', async () => {
    renderForm();
    expect(screen.getByRole('radio', { name: c.white })).toHaveProperty(
      'checked',
      true,
    );
    fireEvent.change(nameField(), { target: { value: 'Taimanovas' } });
    fireEvent.click(screen.getByRole('radio', { name: c.black }));
    fireEvent.click(screen.getByRole('button', { name: c.submit }));
    await waitFor(() => {
      expect(server.create).toHaveBeenCalledTimes(1);
    });
    const form = server.create.mock.lastCall?.[1];
    expect(Object.fromEntries(form?.entries() ?? [])).toEqual({
      name: 'Taimanovas',
      side: 'black',
    });
  });

  it('shows a refusal, marks the name and keeps what was typed', async () => {
    server.create.mockResolvedValue({ refusal: 'repertoire.nameTooLong' });
    renderForm();
    fireEvent.change(nameField(), { target: { value: 'a'.repeat(81) } });
    fireEvent.click(screen.getByRole('button', { name: c.submit }));
    const status = await screen.findByText(MESSAGES.repertoire.nameTooLong);
    expect(status.getAttribute('role')).toBe('status');
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
    expect(nameField().getAttribute('aria-describedby')).toBe(status.id);
    expect(nameField().value).toBe('a'.repeat(81));
  });

  it('says the repertoire limit with its number, without marking the name (R-162)', async () => {
    server.create.mockResolvedValue({ refusal: 'repertoire.limit', limit: 50 });
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: c.submit }));
    await screen.findByText(
      'You can have up to 50 repertoires. Delete one to add another.',
    );
    expect(nameField().getAttribute('aria-invalid')).toBeNull();
  });

  it('does not mark the name for a side refusal', async () => {
    server.create.mockResolvedValue({ refusal: 'repertoire.sideInvalid' });
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: c.submit }));
    await screen.findByText(MESSAGES.repertoire.sideInvalid);
    expect(nameField().getAttribute('aria-invalid')).toBeNull();
  });
});
