import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SideKing } from './side-king';

/** The king glyph's classes, as drawn. */
function classes(side: 'white' | 'black'): string[] {
  const { container } = render(<SideKing side={side} />);
  return [...(container.querySelector('svg')?.classList ?? [])];
}

describe('SideKing (spec "My repertoires")', () => {
  it('draws the White king white with a dark outline, the same in both themes', () => {
    expect(classes('white')).toEqual(
      expect.arrayContaining(['fill-side-white', 'stroke-side-black']),
    );
  });

  it('draws the Black king dark with a light outline, the same in both themes', () => {
    expect(classes('black')).toEqual(
      expect.arrayContaining(['fill-side-black', 'stroke-side-ring']),
    );
  });

  it('is decoration: the heading beside it names the side', () => {
    const { container } = render(<SideKing side="white" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });
});
