'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { AccountMenu } from './account-menu';

/**
 * A page's title row (#381). An inner page names its parent and links to
 * it by href (a shared link still has a way up); on a phone the row also
 * carries the account menu, because the shell's top row is hidden there.
 */
export function PageHeader({
  back,
  title,
  children,
}: {
  readonly back?: { readonly href: string; readonly parent: string };
  readonly title: string;
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
        <h1 className="line-clamp-1 flex-1 text-2xl font-bold sm:text-3xl">
          {title}
        </h1>
        {back === undefined ? null : (
          <div className="md:hidden">
            <AccountMenu />
          </div>
        )}
      </div>
      {children}
    </header>
  );
}
