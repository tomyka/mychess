import { useTranslations } from 'next-intl';
import type { AssignmentActionState } from './assign-actions';

export const INITIAL: AssignmentActionState = {};

/** A refusal, else `saved` once the form has saved; null before. */
export function useOutcome(
  state: AssignmentActionState,
  saved: string,
): { text: string | null; tone: 'success' | 'error' } {
  const t = useTranslations();
  if (state.refusal !== undefined)
    return { text: t(state.refusal), tone: 'error' };
  return { text: state.saved === undefined ? null : saved, tone: 'success' };
}
