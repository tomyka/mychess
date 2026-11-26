import { PANEL_LABEL } from '../repertoire-view';
import { SECTION, SECTION_TITLE } from '../settings/styles';

/**
 * How a repertoire section looks where it is shown: in the repertoire
 * page's panel (a small muted label), or as a card on a Repertoire screen
 * (R-226), whose subheadings are `text-base semibold`.
 */
export type SectionLook = 'panel' | 'card';

export const SECTION_LOOK = {
  panel: {
    section: 'flex flex-col gap-2',
    title: PANEL_LABEL,
    subtitle: PANEL_LABEL,
  },
  card: {
    section: SECTION,
    title: SECTION_TITLE,
    subtitle: 'text-base font-semibold',
  },
} as const satisfies Record<
  SectionLook,
  {
    readonly section: string;
    readonly title: string;
    readonly subtitle: string;
  }
>;
