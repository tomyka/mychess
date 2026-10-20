'use client';

import { useTranslations } from 'next-intl';
import { useId, type JSX } from 'react';
import type { HomeForkOffer } from '../server/assignment-pages';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './buttons';
import {
  acceptForkOfferAction,
  declineForkOfferAction,
  type ForkOfferState,
} from './fork-offer-actions';
import { SECTION, SECTION_TITLE } from './nustatymai/styles';
import { RefusalLine } from './treneris/refusal-line';
import { useLatestAction } from './use-latest-action';

const INITIAL: ForkOfferState = {};

/** One button posting the offer's id to `action`. */
function AnswerForm({
  offerId,
  action,
  pending,
  describedBy,
  className,
  label,
}: {
  readonly offerId: string;
  readonly action: (form: FormData) => void;
  readonly pending: boolean;
  readonly describedBy: string;
  readonly className: string;
  readonly label: string;
}): JSX.Element {
  return (
    <form action={action}>
      <input type="hidden" name="offerId" value={offerId} />
      <button
        type="submit"
        disabled={pending}
        aria-describedby={describedBy}
        className={className}
      >
        {label}
      </button>
    </form>
  );
}

/** One offer: its name, coach and days left, Keep a copy and No, thanks. */
function OfferItem({ offer }: { readonly offer: HomeForkOffer }): JSX.Element {
  const t = useTranslations();
  const nameId = useId();
  const { state, pending, using } = useLatestAction(INITIAL);
  return (
    <li className="flex flex-col gap-2">
      <h3 id={nameId} className="font-semibold">
        {offer.name}
      </h3>
      <span className="text-fg-muted">
        {t('assignment.page.assignedBy', { name: offer.coachName })}
      </span>
      <span>{t('forkOffer.daysLeft', { count: offer.daysLeft })}</span>
      <div className="flex flex-wrap gap-2">
        <AnswerForm
          offerId={offer.id}
          action={using(acceptForkOfferAction)}
          pending={pending}
          describedBy={nameId}
          className={PRIMARY_BUTTON}
          label={t('forkOffer.keep')}
        />
        <AnswerForm
          offerId={offer.id}
          action={using(declineForkOfferAction)}
          pending={pending}
          describedBy={nameId}
          className={SECONDARY_BUTTON}
          label={t('forkOffer.decline')}
        />
      </div>
      <RefusalLine state={state} />
    </li>
  );
}

/**
 * The player's open fork offers on home (R-44, R-45, R-130, R-131): each
 * repertoire they no longer have, to keep as their own copy within the
 * days left. Not shown when there is none.
 */
export function ForkOffers({
  offers,
}: {
  readonly offers: readonly HomeForkOffer[];
}): JSX.Element | null {
  const t = useTranslations('forkOffer');
  const titleId = useId();
  if (offers.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('title')}
      </h2>
      <p className="text-fg-muted">{t('intro')}</p>
      <ul className="flex flex-col gap-4">
        {offers.map((offer) => (
          <OfferItem key={offer.id} offer={offer} />
        ))}
      </ul>
    </section>
  );
}
