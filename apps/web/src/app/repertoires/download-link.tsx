import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { repertoireExportRoute } from '../../lib/routes';
import { SECONDARY_BUTTON } from '../buttons';

/**
 * A repertoire as PGN, its comments included: the owner's own (R-96), or
 * the coach's on an assignment (R-202).
 */
export function DownloadLink({ id }: { readonly id: string }): JSX.Element {
  const t = useTranslations('repertoires.header');
  return (
    <a
      href={repertoireExportRoute(id)}
      download
      className={`${SECONDARY_BUTTON} self-start`}
    >
      {t('download')}
    </a>
  );
}
