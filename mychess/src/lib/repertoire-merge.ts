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

// Chapters of one multi-chapter import are written back-to-back via
// sequential API calls (see PgnImportForm.svelte) — seconds to at most a few
// minutes apart, even for a large study. An unrelated repertoire that merely
// happens to share a base name (e.g. a single import named
// "Najdorf — Sicilian" coinciding textually with an unrelated multi-chapter
// "Najdorf" import) is vanishingly unlikely to have been created within this
// window of a chapter it isn't actually part of — this bounds the blast
// radius of a same-name false match before this function feeds a
// destructive, irreversible merge script (see the plan's Task 14).
const MAX_GAP_MS = 30 * 60 * 1000;

/**
 * Groups repertoires that were split at import time from one multi-chapter
 * PGN back together: same player, same color, same base name, AND created
 * within `MAX_GAP_MS` of each other (clustered consecutively by actual
 * creation time, not just matched by name — see MAX_GAP_MS above). The
 * earliest-created member of each cluster of 2+ becomes canonical. Clusters
 * of exactly one member are omitted — there's nothing to merge.
 */
export function planRepertoireMerges(candidates: MergeCandidate[]): MergeGroup[] {
	const groups = new Map<string, MergeCandidate[]>();
	for (const c of candidates) {
		const key = JSON.stringify([c.playerId, c.color, baseName(c.name)]);
		const list = groups.get(key) ?? [];
		list.push(c);
		groups.set(key, list);
	}

	const merges: MergeGroup[] = [];
	for (const list of groups.values()) {
		const sorted = [...list].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

		let cluster: MergeCandidate[] = [];
		const flushCluster = () => {
			if (cluster.length >= 2) {
				const [canonical, ...duplicates] = cluster;
				merges.push({ canonicalId: canonical.id, duplicateIds: duplicates.map((d) => d.id) });
			}
			cluster = [];
		};

		for (const candidate of sorted) {
			const prev = cluster[cluster.length - 1];
			if (prev && new Date(candidate.createdAt).getTime() - new Date(prev.createdAt).getTime() > MAX_GAP_MS) {
				flushCluster();
			}
			cluster.push(candidate);
		}
		flushCluster();
	}
	return merges;
}
