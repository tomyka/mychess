import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { LichessUnlinkedNotice } from './lichess-unlinked-notice';

const server = vi.hoisted(() => ({
  dismiss: vi.fn<() => Promise<void>>(),
}));

vi.mock('./actions', () => ({
  dismissLichessUnlinkedAction: server.dismiss,
}));

function renderNotice(locale: 'lt' | 'en' = 'lt'): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <LichessUnlinkedNotice />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  server.dismiss.mockReset().mockResolvedValue(undefined);
});

describe('LichessUnlinkedNotice (R-90)', () => {
  it('says Lichess was disconnected for security and can be connected again', () => {
    renderNotice();
    const p = MESSAGES.lt.settings.providers;
    expect(screen.getByRole('note').textContent).toContain(p.lichessUnlinked);
    expect(screen.getByRole('button', { name: p.dismiss })).toBeDefined();
  });

  it('is dismissed through the server', async () => {
    renderNotice();
    fireEvent.click(
      screen.getByRole('button', {
        name: MESSAGES.lt.settings.providers.dismiss,
      }),
    );
    await waitFor(() => {
      expect(server.dismiss).toHaveBeenCalledTimes(1);
    });
  });

  it('speaks English on the English page', () => {
    renderNotice('en');
    const p = MESSAGES.en.settings.providers;
    expect(screen.getByRole('note').textContent).toContain(p.lichessUnlinked);
    expect(screen.getByRole('button', { name: p.dismiss })).toBeDefined();
  });
});
