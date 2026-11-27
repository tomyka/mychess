import { useTranslations } from 'next-intl';

/**
 * A repertoire's title on the coach's pages: its name, or, for the
 * player's Fork of one of the coach's repertoires, "<name>'s own copy of
 * <repertoire>" (R-155), so the coach never takes it for their own. No
 * 'use client': the progress page calls it on the server, where a client
 * module's hook is a reference that throws when called.
 */
export function useOwnCopyTitle({
  isFork,
  playerName,
  repertoireName,
}: {
  readonly isFork: boolean;
  readonly playerName: string;
  readonly repertoireName: string;
}): string {
  const t = useTranslations('coach.progress');
  return isFork
    ? t('ownCopyTitle', { name: playerName, repertoire: repertoireName })
    : repertoireName;
}
