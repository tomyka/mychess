import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
import { BuilderBar, type BuilderBarProps } from './builder-bar';

const lt = MESSAGES.lt;
const b = lt.repertoires.builder;

function renderBar(over: Partial<BuilderBarProps> = {}) {
  const props: BuilderBarProps = {
    move: '6...a6',
    count: 14,
    disabled: false,
    drawMode: false,
    drawColor: 'G',
    onRemove: vi.fn(),
    onDraw: vi.fn(),
    onColor: vi.fn(),
    ...over,
  };
  const view = (next: BuilderBarProps) => (
    <NextIntlClientProvider locale="lt" messages={lt}>
      <BuilderBar {...next} />
    </NextIntlClientProvider>
  );
  const { rerender } = render(view(props));
  return {
    props,
    rerender: (more: Partial<BuilderBarProps>) => {
      rerender(view({ ...props, ...more }));
    },
  };
}

const button = (name: string) => screen.getByRole('button', { name });

describe('BuilderBar: removing a move', () => {
  it('asks first, naming the move and how many moves go with it', () => {
    const { props } = renderBar();
    fireEvent.click(button(b.remove));
    expect(
      screen.getByText(
        'Pašalinti 6...a6 ir 14 po jo einančių ėjimų, kuriuos pasiekia tik jis?',
      ),
    ).toBeDefined();
    expect(document.activeElement).toBe(button(b.removeCancel));
    expect(props.onRemove).not.toHaveBeenCalled();
    fireEvent.click(button(b.removeSubmit));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Pašalinti 6\.\.\.a6/)).toBeNull();
  });

  it('drops the second clause when nothing goes with it', () => {
    renderBar({ count: 0 });
    fireEvent.click(button(b.remove));
    expect(screen.getByText('Pašalinti 6...a6?')).toBeDefined();
  });

  it('cancels with Cancel or Escape and returns focus to Remove move', () => {
    const { props } = renderBar();
    fireEvent.click(button(b.remove));
    fireEvent.click(button(b.removeCancel));
    expect(document.activeElement).toBe(button(b.remove));
    fireEvent.click(button(b.remove));
    fireEvent.keyDown(button(b.removeCancel), { key: 'Escape' });
    expect(document.activeElement).toBe(button(b.remove));
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it('offers no removal at a chapter root, and draw is disabled with the reason', () => {
    renderBar({ move: null });
    expect(screen.queryByRole('button', { name: b.remove })).toBeNull();
    const draw = button(b.draw);
    expect(draw).toHaveProperty('disabled', true);
    expect(draw.getAttribute('aria-describedby')).not.toBeNull();
    expect(screen.getByText(b.drawAtRoot)).toBeDefined();
  });

  it('disables both while saving', () => {
    renderBar({ disabled: true });
    expect(button(b.remove)).toHaveProperty('disabled', true);
    expect(button(b.draw)).toHaveProperty('disabled', true);
  });
});

describe('BuilderBar: draw mode', () => {
  it('is a toggle that turns draw mode on', () => {
    const { props } = renderBar();
    const draw = button(b.draw);
    expect(draw.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(draw);
    expect(props.onDraw).toHaveBeenCalledWith(true);
  });

  it('shows the four colours by name, the chosen one pressed, and the hint', () => {
    const { props } = renderBar({ drawMode: true, drawColor: 'R' });
    const colors = lt.repertoires.colors;
    expect(
      screen
        .getAllByRole('button', { pressed: false })
        .map((c) => c.textContent),
    ).toEqual([colors.G, colors.Y, colors.B]);
    expect(
      screen
        .getByRole('button', { name: colors.R })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('group', { name: b.drawColors })).toBeDefined();
    expect(screen.getByText(b.drawHint)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: colors.B }));
    expect(props.onColor).toHaveBeenCalledWith('B');
    fireEvent.click(button(b.drawDone));
    expect(props.onDraw).toHaveBeenCalledWith(false);
  });

  it('focuses the chosen colour on entering and Draw on leaving', () => {
    const { rerender } = renderBar();
    rerender({ drawMode: true });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: lt.repertoires.colors.G }),
    );
    rerender({ drawMode: false });
    expect(document.activeElement).toBe(button(b.draw));
  });
});
