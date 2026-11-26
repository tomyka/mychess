import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { BACK_BUTTON } from '../buttons';
import { BACK_ICON, Icon } from '../line-icon';
import { PhoneAccountMenu } from '../shell/account-menu';

/** Three dots one above the other: round caps on zero-length strokes. */
const MORE_ICON = 'M12 5h.01M12 12h.01M12 19h.01';

/** More's 44px square, pulled right so its dots line up with the edge. */
const MORE_BUTTON =
  '-mr-2 flex size-touch shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-sunken';

export interface TopBarProps {
  /** Where back leads, and the page it names ("Back to Repertoires"). */
  readonly back: { readonly href: string; readonly parent: string };
  readonly name: string;
  /** The Edit switch (the owner's page only). */
  readonly edit?: ReactNode;
  /** The Repertoire screen (R-226); absent where the viewer has none. */
  readonly moreHref?: string | undefined;
  /** The summary line and status strip under the name. */
  readonly children?: ReactNode;
}

/**
 * The repertoire's header (spec, Header): back, the name on up to two
 * lines, Edit and More, then what the view puts under the name. The
 * phone's top bar; on a desktop the first row of the panel, level with the
 * board's top edge.
 */
export function RepertoireTopBar({
  back,
  name,
  edit,
  moreHref,
  children,
}: TopBarProps): JSX.Element {
  const t = useTranslations();
  return (
    <header className="flex flex-col gap-2 px-gutter pt-1 pb-2 lg:p-0">
      <div className="flex items-center gap-2">
        <Link
          href={back.href}
          aria-label={t('nav.back', { parent: back.parent })}
          className={BACK_BUTTON}
        >
          <Icon path={BACK_ICON} className="size-6" />
        </Link>
        <h1
          title={name}
          className="line-clamp-2 min-w-0 flex-1 text-base font-semibold break-words lg:text-xl"
        >
          {name}
        </h1>
        {edit}
        {moreHref === undefined ? null : (
          <Link
            href={moreHref}
            aria-label={t('repertoires.more')}
            title={t('repertoires.more')}
            className={MORE_BUTTON}
          >
            <Icon path={MORE_ICON} className="size-6" strokeWidth={3} />
          </Link>
        )}
        <PhoneAccountMenu />
      </div>
      {children}
    </header>
  );
}
