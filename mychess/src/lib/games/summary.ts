import type { MoveClassification } from './classify';

export type AnalysisSummary = { blunders: number; mistakes: number; inaccuracies: number };

/** The "My Games" list card's per-category counts, or null before analysis has run. */
export function summarizeAnalysis(
	analysis: { classification: MoveClassification }[] | null
): AnalysisSummary | null {
	if (!analysis) return null;
	const summary: AnalysisSummary = { blunders: 0, mistakes: 0, inaccuracies: 0 };
	for (const entry of analysis) {
		if (entry.classification === 'blunder') summary.blunders++;
		else if (entry.classification === 'mistake') summary.mistakes++;
		else if (entry.classification === 'inaccuracy') summary.inaccuracies++;
	}
	return summary;
}
