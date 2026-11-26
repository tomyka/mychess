import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SideKing } from './side-king';

/** The king glyph's classes, as drawn. */
function classes(side: 'white' | 'black'): string[] {
  const { container } = render(<SideKing side={side} />);
  return [...(container.querySelector('svg')?.classList ?? [])];
}

/** The classes of the tile the king sits on. */
function tile(side: 'white' | 'black'): string[] {
  const { container } = render(<SideKing side={side} />);
  return [...(container.querySelector('svg')?.parentElement?.classList ?? [])];
}

describe('SideKing (spec "My repertoires")', () => {
  it('draws the White king white with a dark outline, the same in both themes', () => {
    expect(classes('white')).toEqual(
      expect.arrayContaining(['fill-side-white', 'stroke-side-black']),
    );
  });

  it('draws the Black king dark with a dark outline, the same in both themes', () => {
    expect(classes('black')).toEqual(
      expect.arrayContaining(['fill-side-black', 'stroke-side-black']),
    );
  });

  it('sets each king on a light-square tile, so the dark page cannot swallow the Black one', () => {
    for (const side of ['white', 'black'] as const)
      expect(tile(side)).toEqual(
        expect.arrayContaining(['bg-board-light', 'rounded-board']),
      );
  });

  it('is decoration: the heading beside it names the side', () => {
    const { container } = render(<SideKing side="white" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });
});
