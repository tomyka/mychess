import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { SyncBanner } from './sync-banner';

const renderIn = (locale: 'lt' | 'en', node: ReactNode) =>
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {node}
    </NextIntlClientProvider>,
  );

describe('the unsynced results banner', () => {
  it('says nothing and offers nothing while every result is saved', () => {
    renderIn('lt', <SyncBanner unsynced={0} onRetry={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('counts the waiting results in Lithuanian plural forms', () => {
    const { rerender } = renderIn(
      'lt',
      <SyncBanner unsynced={1} onRetry={vi.fn()} />,
    );
    expect(screen.getByRole('status').textContent).toContain(
      '1 rezultatas dar neišsaugotas.',
    );
    for (const [count, text] of [
      [3, '3 rezultatai dar neišsaugoti.'],
      [12, '12 rezultatų dar neišsaugota.'],
      [21, '21 rezultatas dar neišsaugotas.'],
    ] as const) {
      rerender(
        <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
          <SyncBanner unsynced={count} onRetry={vi.fn()} />
        </NextIntlClientProvider>,
      );
      expect(screen.getByRole('status').textContent).toContain(text);
    }
  });

  it('counts them in English too', () => {
    renderIn('en', <SyncBanner unsynced={2} onRetry={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain(
      '2 results are not saved yet.',
    );
  });

  it('tries at once when asked', () => {
    const retry = vi.fn();
    renderIn('lt', <SyncBanner unsynced={2} onRetry={retry} />);
    fireEvent.click(
      screen.getByRole('button', { name: MESSAGES.lt.training.sync.retry }),
    );
    expect(retry).toHaveBeenCalledOnce();
  });
});
