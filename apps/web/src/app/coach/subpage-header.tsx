import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { ROUTES } from '../../lib/routes';
import { TEXT_LINK } from '../nustatymai/styles';

/** The column every page of the coach dashboard is laid out in. */
export const COACH_PAGE =
  'mx-auto flex w-full max-w-2xl flex-col gap-8 px-gutter py-8 sm:px-gutter-wide';

/** A coach dashboard page's way back to the dashboard, and its title. */
export function SubpageHeader({
  title,
  titleId,
  children,
}: {
  readonly title: string;
  /** Lets a button name what it acts on (aria-describedby). */
  readonly titleId?: string;
  /** Lines under the title, such as when a player linked. */
  readonly children?: ReactNode;
}): JSX.Element {
  const t = useTranslations('coach');
  return (
    <header className="flex flex-col gap-1">
      <Link href={ROUTES.coach} className={TEXT_LINK}>
        {t('back')}
      </Link>
      <h1 id={titleId} className="text-2xl font-bold break-words sm:text-3xl">
        {title}
      </h1>
      {children}
    </header>
  );
}
