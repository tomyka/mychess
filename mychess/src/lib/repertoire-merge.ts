export type MergeCandidate = {
	id: string;
	playerId: string;
	color: 'white' | 'black';
	name: string;
	createdAt: string;
};

export type MergeGroup = { canonicalId: string; duplicateIds: string[] };

/**
 * `PgnImportForm.svelte` names a multi-chapter import's chapters
 * "{name} — {chapter}" (see `chapterName` in `pgn-import.ts`) — stripping
 * everything from " — " onward recovers the shared base name chapters split
 * from the same import were given.
 */
function baseName(name: string): string {
	return name.split(' — ')[0];
}

/**
 * Groups repertoires that were split at import time from one multi-chapter
 * PGN back together (same player, same color, same base name), earliest-
 * created member of each group of 2+ becoming canonical. Groups of exactly
 * one member are omitted — there's nothing to merge.
 */
export function planRepertoireMerges(candidates: MergeCandidate[]): MergeGroup[] {
	const groups = new Map<string, MergeCandidate[]>();
	for (const c of candidates) {
		const key = `${c.playerId}|${c.color}|${baseName(c.name)}`;
		const list = groups.get(key) ?? [];
		list.push(c);
		groups.set(key, list);
	}

	const merges: MergeGroup[] = [];
	for (const list of groups.values()) {
		if (list.length < 2) continue;
		const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		const [canonical, ...duplicates] = sorted;
		merges.push({ canonicalId: canonical.id, duplicateIds: duplicates.map((d) => d.id) });
	}
	return merges;
}
