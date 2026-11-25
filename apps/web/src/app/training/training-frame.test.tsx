import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { TrainingFrame } from './training-frame';

vi.mock('@lichess-org/chessground', () => ({
  Chessground: () => ({
    set: vi.fn(),
    setShapes: vi.fn(),
    selectSquare: vi.fn(),
    destroy: vi.fn(),
    state: { drawable: { current: undefined } },
  }),
}));

const T = MESSAGES.training;

/** Elements Tab reaches, in the order it reaches them. */
const FOCUSABLE = 'a[href], button, input, [tabindex]:not([tabindex="-1"])';
const tabOrder = (): Element[] =>
  [...document.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.closest('[inert]') === null,
  );

function renderFrame(parts: {
  board?: ReactNode;
  panel: ReactNode;
  actions?: ReactNode;
  banner?: ReactNode;
  title?: string;
  context?: string | null;
}) {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <TrainingFrame
        backHref="/"
        side="white"
        title="Londono sistema"
        context={null}
        progress={{ done: 2, total: 5 }}
        banner={parts.banner ?? null}
        {...parts}
      />
    </NextIntlClientProvider>,
  );
}

describe('the training frame’s tab order', () => {
  it('follows the screen: back, the board, the panel, the bottom bar', () => {
    renderFrame({
      board: <div role="application" aria-label="Lenta" tabIndex={0} />,
      banner: <button type="button">Bandyti dabar</button>,
      panel: <input aria-label="Ėjimas" />,
      actions: <button type="button">Baigti</button>,
    });
    expect(tabOrder()).toEqual([
      screen.getByRole('link', { name: T.back }),
      screen.getByRole('application', { name: 'Lenta' }),
      screen.getByRole('button', { name: 'Bandyti dabar' }),
      screen.getByRole('textbox', { name: 'Ėjimas' }),
      screen.getByRole('button', { name: 'Baigti' }),
    ]);
  });

  it('skips the still board of an empty state', () => {
    renderFrame({ panel: <a href="/mokytis">Mokytis</a> });
    expect(tabOrder()).toEqual([
      screen.getByRole('link', { name: T.back }),
      screen.getByRole('link', { name: 'Mokytis' }),
    ]);
  });
});

describe('the training frame’s header', () => {
  it('shows the context line under the title, outside the heading (R-224)', () => {
    renderFrame({
      panel: null,
      title: "Today's review",
      context: 'Caro-Kann (Black) · Main line',
    });
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.textContent).toBe("Today's review");
    expect(title.nextElementSibling?.textContent).toBe(
      'Caro-Kann (Black) · Main line',
    );
  });

  it('shows the title alone without a context line', () => {
    renderFrame({ panel: null, context: null });
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.textContent).toBe('Londono sistema');
    expect(title.nextElementSibling).toBeNull();
  });

  it('labels the back link for screen readers, an icon on screen', () => {
    renderFrame({ panel: null });
    const back = screen.getByRole('link', { name: T.back });
    expect(back.getAttribute('href')).toBe('/');
    expect(back.textContent).toBe('');
  });

  it('counts the moves as "done / total", without the mode word (R-223)', () => {
    renderFrame({ panel: null });
    expect(screen.getByText('2 / 5').tagName).toBe('P');
  });
});
