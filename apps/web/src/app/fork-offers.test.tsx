import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import type { TodayForkOffer } from '../server/assignment-pages';
import type { ForkOfferState } from './fork-offer-actions';
import { ForkOffers } from './fork-offers';

type Action = (
  previous: ForkOfferState,
  form: FormData,
) => Promise<ForkOfferState>;

const server = vi.hoisted(() => ({
  accept: vi.fn<Action>(),
  decline: vi.fn<Action>(),
}));

vi.mock('./fork-offer-actions', () => ({
  acceptForkOfferAction: server.accept,
  declineForkOfferAction: server.decline,
}));

const f = MESSAGES.forkOffer;

const LONDON: TodayForkOffer = {
  id: 'o-london',
  name: 'Londono sistema',
  coachName: 'Jonas',
  daysLeft: 3,
};

const CARO: TodayForkOffer = {
  id: 'o-caro',
  name: 'Karo-Kan gynyba: pagrindai',
  coachName: 'Rimantas',
  daysLeft: 21,
};

function renderOffers(offers: readonly TodayForkOffer[]): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ForkOffers offers={offers} />
    </NextIntlClientProvider>,
  );
}

const item = (name: string): HTMLElement => {
  const li = screen.getByText(name, { selector: 'h3' }).closest('li');
  if (li === null) throw new Error(`no offer for ${name}`);
  return li;
};

const sent = (action: typeof server.accept): Record<string, unknown> =>
  Object.fromEntries(action.mock.lastCall?.[1].entries() ?? []);

beforeEach(() => {
  server.accept.mockReset().mockResolvedValue({});
  server.decline.mockReset().mockResolvedValue({});
});

describe('ForkOffers (R-44, R-130)', () => {
  it('lists each offer with its coach and the days left', () => {
    renderOffers([LONDON, CARO]);
    expect(
      screen.getByRole('heading', { level: 2, name: f.title }),
    ).toBeDefined();
    const london = item('Londono sistema');
    expect(
      within(london).getByText(
        MESSAGES.assignment.page.assignedBy.replace('{name}', 'Jonas'),
      ),
    ).toBeDefined();
    expect(within(london).getByText('3 days left')).toBeDefined();
    expect(
      within(item('Karo-Kan gynyba: pagrindai')).getByText('21 days left'),
    ).toBeDefined();
  });

  it('keeps a copy of the offer it is under', async () => {
    renderOffers([LONDON, CARO]);
    fireEvent.click(
      within(item('Karo-Kan gynyba: pagrindai')).getByRole('button', {
        name: f.keep,
      }),
    );
    await waitFor(() => {
      expect(sent(server.accept)).toEqual({ offerId: 'o-caro' });
    });
    expect(server.decline).not.toHaveBeenCalled();
  });

  it('declines the offer it is under', async () => {
    renderOffers([LONDON, CARO]);
    fireEvent.click(
      within(item('Londono sistema')).getByRole('button', { name: f.decline }),
    );
    await waitFor(() => {
      expect(sent(server.decline)).toEqual({ offerId: 'o-london' });
    });
    expect(server.accept).not.toHaveBeenCalled();
  });

  it('says when an offer is no longer open', async () => {
    server.accept.mockResolvedValue({ refusal: 'forkOffer.notOpen' });
    renderOffers([LONDON]);
    fireEvent.click(screen.getByRole('button', { name: f.keep }));
    expect(await screen.findByText(f.notOpen)).toBeDefined();
  });

  it('says the repertoire limit with its number (R-162, R-163)', async () => {
    server.accept.mockResolvedValue({ refusal: 'repertoire.limit', limit: 50 });
    renderOffers([LONDON]);
    fireEvent.click(screen.getByRole('button', { name: f.keep }));
    expect(
      await screen.findByText(
        'You can have up to 50 repertoires. Delete one to add another.',
      ),
    ).toBeDefined();
  });

  it('says it for a decline too', async () => {
    server.decline.mockResolvedValue({ refusal: 'forkOffer.notOpen' });
    renderOffers([LONDON]);
    fireEvent.click(screen.getByRole('button', { name: f.decline }));
    expect(await screen.findByText(f.notOpen)).toBeDefined();
  });

  it('shows the latest answer, not an earlier refusal', async () => {
    server.accept.mockResolvedValue({ refusal: 'forkOffer.notOpen' });
    renderOffers([LONDON]);
    fireEvent.click(screen.getByRole('button', { name: f.keep }));
    expect(await screen.findByText(f.notOpen)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: f.decline }));
    await waitFor(() => {
      expect(server.decline).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByText(f.notOpen)).toBeNull();
    });
  });

  it('is not shown without offers', () => {
    renderOffers([]);
    expect(document.body.textContent).toBe('');
  });

  it('says one day in the singular', () => {
    renderOffers([{ ...LONDON, daysLeft: 1 }]);
    expect(screen.getByText('1 day left')).toBeDefined();
  });
});
