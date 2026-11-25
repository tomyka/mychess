import { render } from '@testing-library/react';
import type { JSX } from 'react';
import { describe, expect, it } from 'vitest';
import { Icon } from './line-icon';

/** The one svg rendered. */
function svgOf(element: JSX.Element): SVGSVGElement {
  const { container } = render(element);
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error('an icon is an svg');
  return svg;
}

describe('Icon', () => {
  it('draws its path as a decorative line icon in the text colour', () => {
    const svg = svgOf(<Icon path="M5 12l5 5 9-10" />);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg.getAttribute('class')).toBe('size-5 shrink-0');
    expect(svg.querySelector('path')?.getAttribute('d')).toBe('M5 12l5 5 9-10');
  });

  it('takes its size and weight', () => {
    const svg = svgOf(
      <Icon path="M15 6l-6 6 6 6" className="size-6" strokeWidth={3} />,
    );
    expect(svg.getAttribute('class')).toBe('size-6 shrink-0');
    expect(svg.getAttribute('stroke-width')).toBe('3');
  });
});
