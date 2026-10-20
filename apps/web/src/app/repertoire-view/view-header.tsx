// The top bar of a read-only repertoire view (the coach's shared view, the
// assigned view) and of its loading skeleton
// (docs/design/coach-shared-repertoire.md): on a phone one row, the way
// back then the name, so the board stays high; on a desktop the way back
// spelled out over the name.
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

const FRAME =
  'flex items-center gap-x-3 px-gutter py-1 lg:flex-col lg:items-start lg:gap-1 lg:px-0 lg:py-0';

/**
 * The top bar's frame: a `header` on the page, a plain `div` in the
 * loading skeleton.
 */
export function HeaderFrame({
  element: Element = 'header',
  children,
}: {
  readonly element?: 'header' | 'div';
  readonly children: ReactNode;
}): JSX.Element {
  return <Element className={FRAME}>{children}</Element>;
}

/**
 * The way back: on a phone a chevron, its label for screen readers only;
 * on a desktop the label spelled out.
 */
export function BackLink({
  href,
  label,
}: {
  readonly href: string;
  readonly label: string;
}): JSX.Element {
  return (
    <Link
      href={href}
      className="inline-flex min-h-touch min-w-touch shrink-0 items-center gap-1 text-accent lg:underline"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M15 6l-6 6 6 6" />
      </svg>
      <span className="max-lg:sr-only">{label}</span>
    </Link>
  );
}
