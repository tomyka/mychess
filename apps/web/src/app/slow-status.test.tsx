import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlowStatus } from './slow-status';

describe('SlowStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces nothing at first and the text after about a second', () => {
    render(<SlowStatus text="Įkeliama" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(status.textContent).toBe('Įkeliama');
  });

  it('renders the visible line from the start for CSS to reveal late', () => {
    const { container } = render(<SlowStatus text="Įkeliama" />);
    const line = container.querySelector('[aria-hidden="true"]');
    expect(line?.textContent).toBe('Įkeliama');
    expect(line?.className).toContain('animate-reveal-late');
  });
});
