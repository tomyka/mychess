import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { AttentionCard } from '../../server/coach-pages';
import { NeedsAttention } from './needs-attention';

const card = (
  id: string,
  displayName: string,
  reason: AttentionCard['reason'],
): AttentionCard => ({ player: { id, displayName }, reason });

const FOUR: readonly AttentionCard[] = [
  card('p-1', 'Rokas', {
    kind: 'overdue',
    repertoires: ['Italian'],
    days: 2,
  }),
  card('p-2', 'Gabija', {
    kind: 'deadlineNear',
    repertoire: 'Slav',
    days: 3,
    percent: 3,
  }),
  card('p-3', 'Dovydas', { kind: 'duePile', due: 52 }),
  card('p-4', 'Eglė', { kind: 'idle', days: 12, since: 'training' }),
];

function show(cards: readonly AttentionCard[]): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <NeedsAttention cards={cards} />
    </NextIntlClientProvider>,
  );
  return container;
}

/** The card holding the link named `name`. */
const cardOf = (name: string): HTMLElement => {
  const item = screen.getByRole('link', { name }).closest('li');
  if (item === null) throw new Error(`no card for ${name}`);
  return item;
};

describe('NeedsAttention (R-229)', () => {
  it('heads the cards with their count and says each reason in words', () => {
    show(FOUR);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Needs attention · 4' }),
    ).toBeDefined();
    expect(
      screen.getAllByRole('listitem').map((item) => item.textContent),
    ).toEqual([
      'RokasItalian is 2 days overdue',
      'GabijaSlav due in 3 days · 3% learned',
      'Dovydas52 moves due',
      'EglėHas not trained for 12 days',
    ]);
  });

  it('links each card, named by the player, to their page', () => {
    show(FOUR);
    expect(
      screen.getByRole('link', { name: 'Rokas' }).getAttribute('href'),
    ).toBe('/coach/players/p-1');
  });

  it('gives the number of repertoires when several are overdue', () => {
    show([
      card('p-1', 'Rokas', {
        kind: 'overdue',
        repertoires: ['Italian', 'Slav'],
        days: 5,
      }),
    ]);
    expect(
      within(cardOf('Rokas')).getByText('2 repertoires overdue'),
    ).toBeDefined();
  });

  it('says "due today" and one day in the singular', () => {
    show([
      card('p-1', 'Rokas', {
        kind: 'deadlineNear',
        repertoire: 'Slav',
        days: 0,
        percent: 40,
      }),
      card('p-2', 'Gabija', {
        kind: 'overdue',
        repertoires: ['Slav'],
        days: 1,
      }),
    ]);
    expect(
      within(cardOf('Rokas')).getByText('Slav due today · 40% learned'),
    ).toBeDefined();
    expect(
      within(cardOf('Gabija')).getByText('Slav is 1 day overdue'),
    ).toBeDefined();
  });

  it('counts idle days from the link for a player who never trained', () => {
    show([card('p-1', 'Rokas', { kind: 'idle', days: 9, since: 'link' })]);
    expect(
      within(cardOf('Rokas')).getByText(
        'Has not trained since linking, 9 days ago',
      ),
    ).toBeDefined();
  });

  it('edges each card in its reason’s tone', () => {
    show(FOUR);
    expect(cardOf('Rokas').className).toContain('border-l-error');
    expect(cardOf('Gabija').className).toContain('border-l-due');
    expect(cardOf('Dovydas').className).toContain('border-l-due');
    expect(cardOf('Eglė').className).toContain('border-l-border-strong');
  });

  it('renders nothing when nobody needs attention', () => {
    expect(show([]).innerHTML).toBe('');
  });
});
