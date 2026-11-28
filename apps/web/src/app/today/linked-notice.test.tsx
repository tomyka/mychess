import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { LinkedFact } from '../../server/today-page';
import { LinkedNotice } from './linked-notice';

const t = MESSAGES.today;

function renderNotice(linked: LinkedFact): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <LinkedNotice linked={linked} />
    </NextIntlClientProvider>,
  );
}

describe('LinkedNotice (R-234)', () => {
  it('says whom the player is now linked with, as a status', () => {
    renderNotice({ coachName: 'Rimantas', groupName: null });
    expect(screen.getByRole('status').textContent).toBe(
      'You are linked with Rimantas.',
    );
  });

  it('names the group a group invite came through', () => {
    renderNotice({ coachName: 'Rimantas', groupName: 'Juniors 2026' });
    expect(screen.getByRole('status').textContent).toBe(
      'You are linked with Rimantas through Juniors 2026.',
    );
  });

  it('drops `linked` and `group` from the address once shown, keeping the rest', () => {
    window.history.replaceState(null, '', '/?linked=c1&group=g1&x=1#top');
    renderNotice({ coachName: 'Rimantas', groupName: 'Juniors 2026' });
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('#top');
  });

  it('goes away on Dismiss', () => {
    renderNotice({ coachName: 'Rimantas', groupName: null });
    fireEvent.click(screen.getByRole('button', { name: t.dismiss }));
    expect(screen.queryByText('You are linked with Rimantas.')).toBeNull();
    expect(screen.queryByRole('button', { name: t.dismiss })).toBeNull();
  });
});
