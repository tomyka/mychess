import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { SECONDARY_BUTTON } from '../buttons';

/**
 * A Settings form's last row (#381 part 6): Save, secondary and sized to
 * its label, and beside it "Saved" once a save went through. The note is
 * a polite live region, always rendered, so a screen reader hears it; a
 * refusal shows in the form's own status line instead.
 */
export function SaveRow({
  label,
  pending,
  saved,
}: {
  readonly label: string;
  readonly pending: boolean;
  readonly saved: boolean;
}): JSX.Element {
  const t = useTranslations('settings');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        {label}
      </button>
      <p role="status" className="text-sm font-medium text-success">
        {saved ? t('saved') : ''}
      </p>
    </div>
  );
}
