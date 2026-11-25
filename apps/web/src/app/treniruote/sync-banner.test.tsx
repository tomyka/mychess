import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { SyncBanner } from './sync-banner';

const renderIn = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {node}
    </NextIntlClientProvider>,
  );

describe('the unsynced results banner', () => {
  it('says nothing and offers nothing while every result is saved', () => {
    renderIn(<SyncBanner unsynced={0} onRetry={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('counts the waiting results in singular and plural', () => {
    const { rerender } = renderIn(
      <SyncBanner unsynced={1} onRetry={vi.fn()} />,
    );
    expect(screen.getByRole('status').textContent).toContain(
      '1 result is not saved yet.',
    );
    for (const [count, text] of [
      [2, '2 results are not saved yet.'],
      [21, '21 results are not saved yet.'],
    ] as const) {
      rerender(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <SyncBanner unsynced={count} onRetry={vi.fn()} />
        </NextIntlClientProvider>,
      );
      expect(screen.getByRole('status').textContent).toContain(text);
    }
  });

  it('tries at once when asked', () => {
    const retry = vi.fn();
    renderIn(<SyncBanner unsynced={2} onRetry={retry} />);
    fireEvent.click(
      screen.getByRole('button', { name: MESSAGES.training.sync.retry }),
    );
    expect(retry).toHaveBeenCalledOnce();
  });
});
