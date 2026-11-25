import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { BACK_BUTTON } from '../buttons';
import {
  FRAME_HEAD,
  FRAME_TITLE,
  FRAME_TOP,
  FRAME_TRACK,
} from './frame-classes';
import type { HeaderContext } from './session-header';
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

/** A real item's line, long enough to be cut short at any width. */
const CARO: HeaderContext = {
  text: 'Karo-Kan gynyba: pagrindai (Black) · Caro-Kann Defense: Advance Variation, Short Variation',
  name: 'Karo-Kan gynyba: pagrindai',
  side: '(Black)',
  chapter: 'Caro-Kann Defense: Advance Variation, Short Variation',
};

/** The context line's parts as shown, in order. */
const contextParts = (): Element[] => [
  ...(screen
    .getByRole('heading', { level: 1 })
    .parentElement?.querySelectorAll('[aria-hidden="true"] > span') ?? []),
];

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
  context?: HeaderContext | null;
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
  it('shows the context line under the title, outside the heading, whole once for screen readers (R-224)', () => {
    renderFrame({
      panel: null,
      title: "Today's review",
      context: CARO,
    });
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.textContent).toBe("Today's review");
    const whole = title.nextElementSibling;
    expect(whole?.textContent).toBe(CARO.text);
    expect(whole?.className).toContain('sr-only');
    const shown = whole?.nextElementSibling;
    expect(shown?.getAttribute('aria-hidden')).toBe('true');
    expect(shown?.nextElementSibling).toBeNull();
  });

  it('cuts the name and the chapter short apart, never the side (R-224)', () => {
    renderFrame({ panel: null, context: CARO });
    const parts = contextParts();
    expect(parts.map((p) => p.textContent)).toEqual([
      'Karo-Kan gynyba: pagrindai',
      '(Black)',
      T.context.separator,
      'Caro-Kann Defense: Advance Variation, Short Variation',
    ]);
    const [name, side, separator, chapter] = parts;
    expect(name?.className).toContain('truncate');
    expect(chapter?.className).toContain('truncate');
    expect(side?.className).toContain('shrink-0');
    expect(side?.className).not.toContain('truncate');
    expect(separator?.className).toContain('shrink-0');
  });

  it('shows the side alone, and no separator without a chapter', () => {
    renderFrame({
      panel: null,
      context: { text: 'Black', name: null, side: 'Black', chapter: null },
    });
    expect(contextParts().map((p) => p.textContent)).toEqual(['Black']);
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
    // The shell's back button: its hover and its alignment (#381).
    expect(back.className).toBe(BACK_BUTTON);
  });

  it('counts the moves as "done / total", without the mode word (R-223)', () => {
    renderFrame({ panel: null });
    expect(screen.getByText('2 / 5').tagName).toBe('P');
  });

  it('lays the header out as the loading page does, so the board stays put (#381)', () => {
    renderFrame({ panel: null, context: CARO });
    const title = screen.getByRole('heading', { level: 1 }).parentElement;
    expect(title?.className).toBe(FRAME_TITLE);
    const top = title?.parentElement;
    expect(top?.className).toBe(FRAME_TOP);
    expect(top?.parentElement?.className).toBe(FRAME_HEAD);
    expect(top?.nextElementSibling?.className).toBe(FRAME_TRACK);
  });
});
