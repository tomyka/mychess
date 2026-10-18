'use server';

// The PGN import's actions. Each authenticates, then hands the untrusted
// input to the import use cases, which parse it, re-import the text and
// check access. The owner is always the session account.
import { redirect } from 'next/navigation';
import { repertoireRoute } from '../../../lib/routes';
import {
  confirmImport,
  previewImport,
  type ImportRefused,
  type PreviewOutcome,
} from '../../../server/import-preview';
import { requireOnboarded } from '../../../server/session';

/** What the upload would import: the summary, chapters and skipped games (R-64). */
export async function previewImportAction(
  input: unknown,
): Promise<PreviewOutcome> {
  const account = await requireOnboarded();
  return previewImport(account, input);
}

/** Imports the upload and opens the repertoire; a refusal is returned. */
export async function confirmImportAction(
  input: unknown,
): Promise<ImportRefused> {
  const account = await requireOnboarded();
  const done = await confirmImport(account, input, new Date());
  if (!done.ok) return done;
  redirect(repertoireRoute(done.id));
}
