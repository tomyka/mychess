// mychess/src/routes/(player)/repertoires/new/new.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import NewRepertoire from './+page.svelte';

afterEach(() => cleanup());

describe('new repertoire page', () => {
  it('renders the form fields', () => {
    render(NewRepertoire, { props: { form: null } });
    expect(screen.getByLabelText('Repertoire Name')).toBeTruthy();
    expect(screen.getByText('White')).toBeTruthy();
    expect(screen.getByText('Black')).toBeTruthy();
    expect(screen.getByLabelText('Paste PGN text')).toBeTruthy();
    expect(screen.getByLabelText('…or upload a .pgn file')).toBeTruthy();
  });

  it('shows a form error message when present', () => {
    render(NewRepertoire, { props: { form: { error: 'No valid games found in PGN' } } });
    expect(screen.getByText('No valid games found in PGN')).toBeTruthy();
  });
});
