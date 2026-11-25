import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';
import { ROUTES } from '../../lib/routes';
import { PageHeader, type BackTarget } from '../shell/page-header';
import { CONTENT } from '../surfaces';

/** The column every page of the coach dashboard is laid out in. */
export const COACH_PAGE = `${CONTENT} gap-8`;

/**
 * A coach dashboard page's title, with its way back: to the dashboard
 * unless the page names another parent (#381).
 */
export function SubpageHeader({
  title,
  titleId,
  back,
  children,
}: {
  readonly title: string;
  /** Lets a button name what it acts on (aria-describedby). */
  readonly titleId?: string;
  /** The parent page, when it is not the dashboard. */
  readonly back?: BackTarget;
  /** Lines under the title, such as when a player linked. */
  readonly children?: ReactNode;
}): JSX.Element {
  const t = useTranslations('nav');
  return (
    <PageHeader
      back={back ?? { href: ROUTES.coach, parent: t('coach') }}
      title={title}
      {...(titleId === undefined ? {} : { titleId })}
    >
      {children}
    </PageHeader>
  );
}
