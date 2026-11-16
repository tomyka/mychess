import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import type { BroadcastLinkState } from '../../server/broadcast-link';
import { BroadcastLinkForm } from './broadcast-link-form';

const en = MESSAGES.en.fide;

const server = vi.hoisted(() => ({
  add: vi.fn<
    (previous: unknown, form: FormData) => Promise<BroadcastLinkState>
  >(),
}));

vi.mock('./actions', () => ({ addBroadcastLinkAction: server.add }));

const LINK = 'https://lichess.org/broadcast/vilnius-open-2026/VilOpn26';

function renderForm(): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
      <BroadcastLinkForm />
    </NextIntlClientProvider>,
  );
}

const field = (): HTMLInputElement => {
  const input = screen.getByLabelText(en.linkLabel);
  if (!(input instanceof HTMLInputElement)) throw new Error('no link field');
  return input;
};

async function paste(link: string): Promise<void> {
  fireEvent.change(field(), { target: { value: link } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: en.addSubmit }));
    await Promise.resolve();
  });
}

const statusText = (): string | null => screen.getByRole('status').textContent;

beforeEach(() => {
  server.add.mockReset().mockResolvedValue({ kind: 'idle' });
});

describe('the Add a Lichess broadcast form (#349)', () => {
  it('has a titled section with a link field, its hint and an Add button', () => {
    renderForm();
    expect(screen.getByRole('region', { name: en.addTitle })).toBeDefined();
    expect(screen.getByText(en.addIntro)).toBeDefined();
    expect(field().name).toBe('link');
    expect(field().type).toBe('url');
    expect(field().inputMode).toBe('url');
    expect(field().form?.method).toBe('post');
    const hint = screen.getByText(en.linkHint);
    expect(field().getAttribute('aria-describedby')).toBe(hint.id);
    expect(field().getAttribute('aria-invalid')).toBeNull();
    expect(statusText()).toBe('');
  });

  it('posts the pasted link and says the tournament was added', async () => {
    server.add.mockResolvedValue({ kind: 'added', name: 'Vilnius Open 2026' });
    renderForm();
    await paste(LINK);
    expect(server.add.mock.lastCall?.[1].get('link')).toBe(LINK);
    expect(statusText()).toBe(
      'Vilnius Open 2026 was added. Its games will appear in searches once they are fetched.',
    );
    expect(field().getAttribute('aria-invalid')).toBeNull();
  });

  it('says a tournament already added', async () => {
    server.add.mockResolvedValue({ kind: 'known', name: 'Vilnius Open 2026' });
    renderForm();
    await paste(LINK);
    expect(statusText()).toBe('Vilnius Open 2026 is already added.');
  });

  it.each([
    ['fide.broadcastLinkInvalid', en.broadcastLinkInvalid],
    ['fide.broadcastLinkUnavailable', en.broadcastLinkUnavailable],
    ['fide.tourNotFound', en.tourNotFound],
    ['fide.tourNotFinished', en.tourNotFinished],
    ['fide.tourOutsideWindow', en.tourOutsideWindow],
    ['fide.tourInDumps', en.tourInDumps],
  ] as const)(
    'shows the refusal %s, keeps the link and marks the field',
    async (refusal, text) => {
      server.add.mockResolvedValue({ kind: 'refused', refusal });
      renderForm();
      await paste('https://example.com');
      const status = screen.getByRole('status');
      expect(status.textContent).toBe(text);
      expect(field().value).toBe('https://example.com');
      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(field().getAttribute('aria-describedby')).toContain(status.id);
    },
  );

  it('shows the daily limit of links', async () => {
    server.add.mockResolvedValue({
      kind: 'refused',
      refusal: 'fide.tooManyBroadcastLinks',
      limit: 10,
    });
    renderForm();
    await paste(LINK);
    expect(statusText()).toBe(
      'Too many links: at most 10 a day. Try again tomorrow.',
    );
  });
});
