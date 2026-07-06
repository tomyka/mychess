// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import OpeningPicker from './OpeningPicker.svelte';

afterEach(() => cleanup());

describe('OpeningPicker', () => {
  it('shows no opening results until the user types a query', () => {
    render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
    expect(screen.queryByText(/Najdorf/i)).toBeNull();
  });

  it('always shows an Unclassified option', () => {
    render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
    expect(screen.getByText('Unclassified')).toBeTruthy();
  });

  it('filters results as the user types', async () => {
    render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
    const input = screen.getByPlaceholderText(/search openings/i);
    await fireEvent.input(input, { target: { value: 'najdorf' } });
    expect(screen.getByText(/Najdorf/i)).toBeTruthy();
  });

  it('shows "No matches." for a query that matches nothing', async () => {
    render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
    const input = screen.getByPlaceholderText(/search openings/i);
    await fireEvent.input(input, { target: { value: 'zzz-no-such-opening' } });
    expect(screen.getByText('No matches.')).toBeTruthy();
  });

  it('calls onclose when the close button is clicked', async () => {
    const onclose = vi.fn();
    render(OpeningPicker, { props: { repId: 'r1', onclose } });
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onclose).toHaveBeenCalled();
  });
});
