import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { BACK_BUTTON } from '../buttons';
import { BACK_ICON, Icon } from '../line-icon';

/** Three dots one above the other: round caps on zero-length strokes. */
const MORE_ICON = 'M12 5h.01M12 12h.01M12 19h.01';

/** More's 44px square, pulled right so its dots line up with the edge. */
const MORE_BUTTON =
  '-mr-2 flex size-touch shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-sunken';

export interface TopBarProps {
  /** Where back leads, and the page it names ("Back to Repertoires"). */
  readonly back: { readonly href: string; readonly parent: string };
  readonly name: string;
  /** The row's own control: the owner's Edit switch, the coach's Progress link. */
  readonly edit?: ReactNode;
  /** The Repertoire screen (R-226); absent where the viewer has none. */
  readonly moreHref?: string | undefined;
  /** A line under the name saying what the viewer may do with it (the coach's "Shared with you · read-only"). */
  readonly tag?: string | undefined;
}

/** Where the name goes: the full desktop row, after the controls. */
const NAME_ROW = 'min-w-0 flex-1 lg:order-last lg:basis-full';

/** The name: 16px on 20px lines, two in the 44px row; larger on a desktop. */
const NAME_TEXT = 'text-base/5 font-semibold break-words lg:text-xl';

/**
 * The name, and the tag under it in one column when there is one, so the
 * tag never takes a row of its own.
 */
function Name({
  name,
  tag,
}: {
  readonly name: string;
  readonly tag: string | undefined;
}): JSX.Element {
  if (tag === undefined)
    return <h1 className={`${NAME_ROW} ${NAME_TEXT}`}>{name}</h1>;
  return (
    <div className={NAME_ROW}>
      <h1 className={NAME_TEXT}>{name}</h1>
      <p className="text-xs/4 text-fg-muted">{tag}</p>
    </div>
  );
}

/**
 * The repertoire's header (spec, Header), the phone's one row above the
 * board: back, the name, Edit and More. The name is never clamped: its end
 * ("6.Be3 Ng4") is what tells two repertoires apart, so it wraps in full,
 * on 20px lines so two fit the 44px row. No account menu here: every pixel
 * of the row goes to the name, and the menu is one tab away.
 * On a desktop, the first row of the panel's card: back, Edit and More,
 * then the name on its own full-width row. The summary line is first in
 * the panel (RepertoirePanel), so the board keeps its room on a phone.
 */
export function RepertoireTopBar({
  back,
  name,
  edit,
  moreHref,
  tag,
}: TopBarProps): JSX.Element {
  const t = useTranslations();
  return (
    <header className="flex items-center gap-2 lg:flex-wrap lg:gap-y-2">
      <Link
        href={back.href}
        aria-label={t('nav.back', { parent: back.parent })}
        className={BACK_BUTTON}
      >
        <Icon path={BACK_ICON} className="size-6" />
      </Link>
      <Name name={name} tag={tag} />
      <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
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
      </div>
    </header>
  );
}
