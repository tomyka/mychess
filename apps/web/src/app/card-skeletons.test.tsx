import { act, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import { CardSkeletons } from './card-skeletons';
import FideLoading from './fide/loading';
import InviteLoading from './invite/[token]/loading';
import SettingsLoading from './settings/loading';

const LOADING = MESSAGES.repertoires.loading;

function renderIn(page: JSX.Element): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {page}
    </NextIntlClientProvider>,
  );
}

/** "Loading" is announced once the wait is felt, as on the other loading pages. */
function expectSlowLoading(): void {
  const status = screen.getByRole('status');
  expect(status.textContent).toBe('');
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(status.textContent).toBe(LOADING);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CardSkeletons (#381 part 6)', () => {
  it('says Loading after about a second, and gives a screen reader nothing else', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <CardSkeletons sizes={['h-10 w-48', 'h-48', 'h-32']} />
      </NextIntlClientProvider>,
    );
    expectSlowLoading();
    // The placeholders and the visible line are hidden; only the live
    // region is read out.
    const readable = Array.from(container.children).filter(
      (child) => child.getAttribute('aria-hidden') !== 'true',
    );
    expect(readable).toHaveLength(1);
    expect(readable[0]?.contains(screen.getByRole('status'))).toBe(true);
    // One placeholder per size, besides that line.
    expect(container.children).toHaveLength(4);
  });
});

describe('the loading pages (#381 part 6)', () => {
  it('Settings is busy under its own header, back to Today', () => {
    renderIn(<SettingsLoading />);
    const main = screen.getByRole('main');
    expect(main.getAttribute('aria-busy')).toBe('true');
    expect(
      within(main).getByRole('heading', {
        level: 1,
        name: MESSAGES.settings.title,
      }),
    ).toBeDefined();
    expect(
      within(main)
        .getByRole('link', {
          name: MESSAGES.nav.back.replace('{parent}', MESSAGES.nav.today),
        })
        .getAttribute('href'),
    ).toBe('/');
    expectSlowLoading();
  });

  it('Opponents is busy under its own header and intro', () => {
    renderIn(<FideLoading />);
    const main = screen.getByRole('main');
    expect(main.getAttribute('aria-busy')).toBe('true');
    expect(
      within(main).getByRole('heading', {
        level: 1,
        name: MESSAGES.fide.title,
      }),
    ).toBeDefined();
    expect(within(main).getByText(MESSAGES.fide.intro)).toBeDefined();
    expectSlowLoading();
  });

  it('the invite page is busy in the entry frame', () => {
    renderIn(<InviteLoading />);
    expect(screen.getByRole('link', { name: 'MyChess' })).toBeDefined();
    // The frame's main landmark is what is busy, as on the other pages.
    const main = screen.getByRole('main');
    expect(main.getAttribute('aria-busy')).toBe('true');
    expectSlowLoading();
  });
});
