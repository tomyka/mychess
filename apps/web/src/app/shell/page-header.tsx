'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { BACK_BUTTON } from '../buttons';
import { BACK_ICON, Icon } from '../line-icon';
import { PhoneAccountMenu } from './account-menu';

/** An inner page's parent: where its way back leads, and its name. */
export interface BackTarget {
  readonly href: string;
  readonly parent: string;
}

/**
 * A page's title row (#381). An inner page names its parent and links to
 * it by href (a shared link still has a way up); on a phone the row also
 * carries the account menu, because the shell's top row is hidden there.
 */
export function PageHeader({
  back,
  title,
  titleId,
  actions,
  children,
}: {
  readonly back?: BackTarget;
  readonly title: string;
  /** Lets a button name what it acts on (aria-describedby). */
  readonly titleId?: string;
  /** The page's own actions, at the end of the title row (Invite a player). */
  readonly actions?: ReactNode;
  /** A line under the title (an intro), if any. */
  readonly children?: ReactNode;
}): JSX.Element {
  const t = useTranslations('nav');
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {back === undefined ? null : (
          <Link
            href={back.href}
            aria-label={t('back', { parent: back.parent })}
            className={BACK_BUTTON}
          >
            <Icon path={BACK_ICON} className="size-6" />
          </Link>
        )}
        <h1
          id={titleId}
          className="min-w-0 flex-1 text-2xl font-bold break-words sm:text-3xl"
        >
          {title}
        </h1>
        {actions}
        {back === undefined ? null : <PhoneAccountMenu />}
      </div>
      {children}
    </header>
  );
}
