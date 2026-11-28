import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EntryFrame } from './entry-frame';

describe('EntryFrame (#381 part 6)', () => {
  it('heads the page with the wordmark, a link to Today', () => {
    render(<EntryFrame>body</EntryFrame>);
    const wordmark = screen.getByRole('link', { name: 'MyChess' });
    expect(wordmark.getAttribute('href')).toBe('/');
    // Outside the main landmark, as the top bar's.
    expect(screen.getByRole('main').contains(wordmark)).toBe(false);
  });

  it('holds its children in a single card in the main landmark', () => {
    render(
      <EntryFrame>
        <h1>Sign in</h1>
        <p>Then train</p>
      </EntryFrame>,
    );
    const main = screen.getByRole('main');
    expect(main.children).toHaveLength(1);
    const [card] = Array.from(main.children);
    expect(card?.textContent).toBe('Sign inThen train');
    expect(
      within(main).getByRole('heading', { level: 1, name: 'Sign in' }),
    ).toBeDefined();
  });

  it('marks its main landmark busy while its page loads, and only then', () => {
    const { rerender } = render(<EntryFrame busy>loading</EntryFrame>);
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    rerender(<EntryFrame>body</EntryFrame>);
    expect(screen.getByRole('main').hasAttribute('aria-busy')).toBe(false);
  });

  it('renders `below` after the card, outside it', () => {
    render(
      <EntryFrame below={<button type="button">Delete account…</button>}>
        <h1>Welcome!</h1>
      </EntryFrame>,
    );
    const main = screen.getByRole('main');
    const [card, below] = Array.from(main.children);
    const button = screen.getByRole('button', { name: 'Delete account…' });
    expect(card?.contains(button)).toBe(false);
    expect(below?.contains(button)).toBe(true);
  });
});
