import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
import type { RepertoireSharing } from '../../../server/repertoires';
import { ShareWithCoach } from './share-with-coach';
import type { ShareState } from './sharing-actions';

const server = vi.hoisted(() => ({
  setShares:
    vi.fn<(previous: ShareState, form: FormData) => Promise<ShareState>>(),
}));

vi.mock('./sharing-actions', () => ({ setSharesAction: server.setShares }));

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const s = MESSAGES.lt.share;

const TWO_COACHES: RepertoireSharing = {
  coaches: [
    { id: 'c-1', displayName: 'Dovydas' },
    { id: 'c-2', displayName: 'Rimantas' },
  ],
  sharedWith: ['c-2'],
};

function renderShare(
  sharing: RepertoireSharing,
  locale: 'lt' | 'en' = 'lt',
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <ShareWithCoach repertoireId={ID} sharing={sharing} />
    </NextIntlClientProvider>,
  );
}

const sent = () => {
  const form = server.setShares.mock.lastCall?.[1];
  return {
    repertoireId: form?.get('repertoireId'),
    coachIds: form?.getAll('coachIds'),
  };
};

beforeEach(() => {
  server.setShares.mockReset().mockResolvedValue({ shared: 1 });
});

describe('ShareWithCoach (R-42)', () => {
  it('lists the linked coaches, ticked where it is shared', () => {
    renderShare(TWO_COACHES);
    expect(
      screen.getByRole('heading', { level: 2, name: s.title }),
    ).toBeDefined();
    expect(screen.getByText(s.intro)).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Dovydas' })).toHaveProperty(
      'checked',
      false,
    );
    expect(screen.getByRole('checkbox', { name: 'Rimantas' })).toHaveProperty(
      'checked',
      true,
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Bendrinama su 1 treneriu',
    );
  });

  it('saves the ticked coaches for this repertoire and says how many', async () => {
    server.setShares.mockResolvedValue({ shared: 2 });
    renderShare(TWO_COACHES);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dovydas' }));
    fireEvent.click(screen.getByRole('button', { name: s.save }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'Bendrinama su 2 treneriais',
      );
    });
    expect(sent()).toEqual({ repertoireId: ID, coachIds: ['c-1', 'c-2'] });
  });

  it('says before any save when it is shared with nobody', () => {
    renderShare({ ...TWO_COACHES, sharedWith: [] });
    expect(screen.getByRole('status').textContent).toBe(s.notShared);
  });

  it('says when it is shared with nobody', async () => {
    server.setShares.mockResolvedValue({ shared: 0 });
    renderShare(TWO_COACHES);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Rimantas' }));
    fireEvent.click(screen.getByRole('button', { name: s.save }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(s.notShared);
    });
    expect(sent()).toEqual({ repertoireId: ID, coachIds: [] });
  });

  it('shows a refusal', async () => {
    server.setShares.mockResolvedValue({
      shared: 1,
      refusal: 'share.notLinked',
    });
    renderShare(TWO_COACHES);
    fireEvent.click(screen.getByRole('button', { name: s.save }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(s.notLinked);
    });
  });

  it('explains that sharing needs a coach when there is none', () => {
    renderShare({ coaches: [], sharedWith: [] });
    expect(screen.getByText(s.noCoach)).toBeDefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: s.save })).toBeNull();
  });

  it('speaks English on the English page', async () => {
    renderShare(TWO_COACHES, 'en');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Share with a coach' }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'Shared with 1 coach',
      );
    });
  });
});
