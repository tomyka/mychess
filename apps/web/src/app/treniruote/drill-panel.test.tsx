import { render, screen } from '@testing-library/react';
import { START_KEY, type RepertoireMove } from '@mychess/chess';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphOf } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/locales';
import { LineSoFar } from './drill-panel';

const LINE = graphOf('1. d4 d5 2. Bf4 Nf6 3. e3 e6 4. Nf3 c5 *').moves;

function Line({
  moves,
}: {
  readonly moves: readonly RepertoireMove[];
}): JSX.Element {
  return (
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <LineSoFar moves={moves} rootKey={START_KEY} />
    </NextIntlClientProvider>
  );
}

const lineRow = (): HTMLElement => screen.getByText(/^1\. d4/u);

describe('LineSoFar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the whole line, so a screen reader reads every move', () => {
    render(<Line moves={LINE} />);
    expect(lineRow().textContent).toBe(
      '1. d4 d5 2. Bf4 Nf6 3. e3 e6 4. Nf3 c5',
    );
  });

  it('keeps the newest move in view when the line grows', () => {
    const width = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockReturnValue(120);
    const { rerender } = render(<Line moves={LINE.slice(0, 3)} />);
    expect(lineRow().scrollLeft).toBe(120);

    width.mockReturnValue(480);
    rerender(<Line moves={LINE} />);
    expect(lineRow().scrollLeft).toBe(480);
  });
});
