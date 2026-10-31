import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/locales';
import type { HomeForkOffer } from '../server/assignment-pages';
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

const lt = MESSAGES.lt;
const f = lt.forkOffer;

const LONDON: HomeForkOffer = {
  id: 'o-london',
  name: 'Londono sistema',
  coachName: 'Jonas',
  daysLeft: 3,
};

const CARO: HomeForkOffer = {
  id: 'o-caro',
  name: 'Karo-Kan gynyba: pagrindai',
  coachName: 'Rimantas',
  daysLeft: 21,
};

function renderOffers(
  offers: readonly HomeForkOffer[],
  locale: 'lt' | 'en' = 'lt',
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
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
        lt.assignment.page.assignedBy.replace('{name}', 'Jonas'),
      ),
    ).toBeDefined();
    expect(within(london).getByText('Liko 3 dienos')).toBeDefined();
    expect(
      within(item('Karo-Kan gynyba: pagrindai')).getByText('Liko 21 diena'),
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
        'Galite turėti ne daugiau kaip 50 repertuarų. Ištrinkite kurį nors, kad pridėtumėte naują.',
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

  it('speaks English on the English page', () => {
    renderOffers([{ ...LONDON, daysLeft: 1 }], 'en');
    expect(screen.getByText('1 day left')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Keep a copy' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'No, thanks' })).toBeDefined();
  });
});
