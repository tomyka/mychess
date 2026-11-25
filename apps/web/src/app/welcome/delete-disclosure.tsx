import type { DeletableAccount } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { DeleteSection } from '../nustatymai/delete-section';

/**
 * A way out before onboarding (R-86): the delete section, folded away
 * under a quiet link so it does not compete with the form above it.
 * `canExport` is whether the session may download the data first (R-95).
 */
export function DeleteDisclosure({
  account,
  canExport,
}: {
  readonly account: DeletableAccount;
  readonly canExport: boolean;
}): JSX.Element {
  const t = useTranslations('onboarding');
  return (
    <details className="flex flex-col gap-4">
      <summary className="inline-flex min-h-touch cursor-pointer items-center self-start text-fg-muted underline">
        {t('deleteAccount')}
      </summary>
      <DeleteSection account={account} canExport={canExport} />
    </details>
  );
}
