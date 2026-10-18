import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
import type { ScreenMessage } from './screen-state';
import { ScreenStatus } from './screen-status';

function renderStatus(message: ScreenMessage | null, stale = false) {
  const onReload = vi.fn<() => void>();
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <ScreenStatus message={message} stale={stale} onReload={onReload} />
    </NextIntlClientProvider>,
  );
  return onReload;
}

describe('ScreenStatus', () => {
  it('says a message in its tone', () => {
    renderStatus({ key: 'repertoires.board.notInRepertoire', tone: 'info' });
    const line = screen.getByRole('status');
    expect(line.textContent).toBe(
      MESSAGES.lt.repertoires.board.notInRepertoire,
    );
    expect(line.className).toContain('bg-sunken');
  });

  it('fills in a message’s values', () => {
    renderStatus({
      key: 'repertoires.nav.endOfLine',
      tone: 'info',
      values: { move: '4. Nf3' },
    });
    expect(screen.getByRole('status').textContent).toBe(
      '4. Nf3, linijos pabaiga',
    );
  });

  it('says a request failed for a key the catalogue does not have', () => {
    renderStatus({ key: 'repertoire.somethingNew', tone: 'error' });
    expect(screen.getByRole('status').textContent).toBe(
      MESSAGES.lt.repertoires.failed,
    );
  });

  it('is empty without a message', () => {
    renderStatus(null);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers Reload when the repertoire changed elsewhere, with focus on it', () => {
    const onReload = renderStatus(
      { key: 'repertoire.stale', tone: 'error' },
      true,
    );
    const reload = screen.getByRole('button', {
      name: MESSAGES.lt.repertoires.stale.reload,
    });
    expect(document.activeElement).toBe(reload);
    fireEvent.click(reload);
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
