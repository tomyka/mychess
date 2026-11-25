'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
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
  children,
}: {
  readonly back?: BackTarget;
  readonly title: string;
  /** Lets a button name what it acts on (aria-describedby). */
  readonly titleId?: string;
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
            className="-ml-2 flex size-touch shrink-0 items-center justify-center rounded-control text-accent hover:bg-sunken"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </Link>
        )}
        <h1
          id={titleId}
          className="min-w-0 flex-1 text-2xl font-bold break-words sm:text-3xl"
        >
          {title}
        </h1>
        {back === undefined ? null : <PhoneAccountMenu />}
      </div>
      {children}
    </header>
  );
}
