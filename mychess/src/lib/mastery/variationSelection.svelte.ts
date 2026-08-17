// mychess/src/lib/mastery/variationSelection.svelte.ts
import type { VariationStep } from './variations';

export type VariationRow = {
	variationKey: string;
	label: string;
	included: boolean;
	// Every chapter this line belongs to — a line cross-referenced by two
	// chapters shows (and toggles) under both. Empty means untagged, which
	// gets its own UNTAGGED_CHAPTER bucket inside a chaptered repertoire.
	chapterNames: string[];
	path: VariationStep[];
	solved: boolean;
};

/**
 * One repertoire's practice-exclusion selection: the lazily-fetched variation
 * rows plus every mutation that can be made to them (one variation, or any
 * bulk scope — the whole repertoire, a chapter, a move-group bucket).
 *
 * Lives outside the components because BOTH halves of the practice picker need
 * it: `RepertoirePracticeRow` renders the collapsed summary (its live
 * solved/total counts and its repertoire-level checkbox both derive from
 * `variations`, and that checkbox bulk-toggles the `__all__` scope), while
 * `RepertoireVariationTree` renders the expanded chapter/move-group tree and
 * toggles the narrower scopes. Sharing one instance keeps them looking at, and
 * writing to, exactly the same rows — no `$bindable` plumbing of `variations`,
 * `snapshots` and `errorMessage` through props, and no second copy of the
 * optimistic-update logic.
 */
export class VariationSelection {
	/** A getter, not a captured string, so a re-used component instance pointed at a different repertoire still posts to the right one. */
	#repertoireId: () => string;

	variations = $state<VariationRow[] | null>(null);
	loading = $state(false);
	errorMessage = $state<string | null>(null);

	// Keyed by toggle scope ('__all__' for the repertoire-level checkbox,
	// `chapter:{chapter}` for a chapter tier's own checkbox, or
	// `moveGroup:{chapter}::{groupKey}` for a move-group bucket's own
	// checkbox) — the set of variationKeys that were included right before
	// that scope's checkbox last bulk-excluded everything, so re-checking it
	// restores exactly that selection instead of blanket-including everything.
	// Independent per scope: bulk-excluding one bucket never touches another
	// bucket's, chapter's, or the repertoire-level checkbox's own snapshot.
	// Deliberately NOT `$state` — nothing renders from it, only `toggleGroup`
	// reads it, so it needs no reactivity.
	#snapshots: Map<string, Set<string>> = new Map();

	constructor(repertoireId: () => string) {
		this.#repertoireId = repertoireId;
	}

	async ensureLoaded(): Promise<VariationRow[]> {
		if (this.variations) return this.variations;
		this.loading = true;
		try {
			const res = await fetch(`/api/repertoires/${this.#repertoireId()}/variations`);
			if (!res.ok) throw new Error('load failed');
			const data = (await res.json()) as VariationRow[];
			this.variations = data;
			this.errorMessage = null;
			return data;
		} catch {
			this.errorMessage = "Couldn't load variations — try again.";
			throw new Error('load failed');
		} finally {
			this.loading = false;
		}
	}

	async #postExclusion(variationKeys: string[], included: boolean): Promise<boolean> {
		try {
			const res = await fetch(`/api/repertoires/${this.#repertoireId()}/exclusions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys, included })
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	async toggleVariation(key: string) {
		try {
			await this.ensureLoaded();
		} catch {
			return;
		}
		const current = this.variations!;
		const target = current.find((v) => v.variationKey === key);
		if (!target) return;
		const nextIncluded = !target.included;
		this.variations = current.map((v) => (v.variationKey === key ? { ...v, included: nextIncluded } : v));
		const ok = await this.#postExclusion([key], nextIncluded);
		if (!ok) {
			// Revert only this one row, applied on top of whatever `variations`
			// is NOW rather than the stale snapshot captured above — another
			// toggle elsewhere may have completed while this request was in
			// flight, and that change must survive this one's failure.
			this.variations = (this.variations ?? []).map((v) =>
				v.variationKey === key ? { ...v, included: target.included } : v
			);
			this.errorMessage = "Couldn't update that — try again.";
		} else {
			this.errorMessage = null;
		}
	}

	/**
	 * Bulk-toggles every currently-loaded variation for which `belongsToGroup`
	 * is true — used for the repertoire-level checkbox (every variation),
	 * each chapter header's own checkbox (just that chapter's rows), and each
	 * move-group bucket's own checkbox (just that bucket's rows). `scopeKey`
	 * isolates the uncheck/recheck snapshot per toggle so they never
	 * interfere with each other (see `#snapshots`' doc comment above).
	 *
	 * On failure, reverts only the rows THIS call touched — each back to its
	 * own pre-toggle `included` value — applied on top of whatever
	 * `variations` is at that moment, not a stale snapshot from before the
	 * `await`. Two toggles (e.g. one bulk chapter exclude and one individual
	 * variation checkbox) can genuinely overlap in flight; a wholesale
	 * revert to an old snapshot would silently erase whichever of them
	 * finished first.
	 */
	async toggleGroup(scopeKey: string, belongsToGroup: (row: VariationRow) => boolean) {
		try {
			await this.ensureLoaded();
		} catch {
			return;
		}
		const current = this.variations!;
		const rows = current.filter(belongsToGroup);
		const originalIncludedByKey = new Map(rows.map((v) => [v.variationKey, v.included]));

		const revertTouchedRows = () => {
			this.variations = (this.variations ?? []).map((v) => {
				const original = originalIncludedByKey.get(v.variationKey);
				return original === undefined ? v : { ...v, included: original };
			});
		};

		// Restores just THIS scope's own snapshot entry to whatever it was
		// in `previous`, applied on top of the current, live `#snapshots` —
		// not a wholesale `#snapshots = previous`, which would erase any
		// other scope's entry set (or cleared) by a concurrent toggle while
		// this one's request was in flight. Mirrors `revertTouchedRows`
		// above for the same reason.
		const revertSnapshotEntry = (previous: Map<string, Set<string>>) => {
			const next = new Map(this.#snapshots);
			if (previous.has(scopeKey)) next.set(scopeKey, previous.get(scopeKey)!);
			else next.delete(scopeKey);
			this.#snapshots = next;
		};

		// Anything in scope still included (or nothing in scope at all — the
		// same 'checked' aggregate an empty group renders as) means this
		// checkbox reads checked or indeterminate, so clicking it excludes.
		if (rows.length === 0 || rows.some((v) => v.included)) {
			// Checked or indeterminate -> bulk-exclude this scope's rows,
			// remembering exactly which ones were included so a re-check can
			// restore them. Only the currently-included keys are posted — an
			// already-excluded variation doesn't need a redundant write.
			const included = rows.filter((v) => v.included).map((v) => v.variationKey);
			const previousSnapshots = this.#snapshots;
			this.#snapshots = new Map(this.#snapshots).set(scopeKey, new Set(included));
			this.variations = current.map((v) => (belongsToGroup(v) ? { ...v, included: false } : v));
			const ok = await this.#postExclusion(included, false);
			if (!ok) {
				revertTouchedRows();
				revertSnapshotEntry(previousSnapshots);
				this.errorMessage = "Couldn't update that — try again.";
			} else {
				this.errorMessage = null;
			}
			return;
		}

		// Unchecked -> restore the pre-uncheck selection if we have one from
		// this visit, otherwise default to including everything in scope.
		const rowKeys = new Set(rows.map((v) => v.variationKey));
		const toInclude = this.#snapshots.get(scopeKey) ?? rowKeys;
		const previousSnapshots = this.#snapshots;
		this.variations = current.map((v) => (belongsToGroup(v) ? { ...v, included: toInclude.has(v.variationKey) } : v));
		const nextSnapshots = new Map(this.#snapshots);
		nextSnapshots.delete(scopeKey);
		this.#snapshots = nextSnapshots;
		const ok = await this.#postExclusion([...toInclude], true);
		if (!ok) {
			revertTouchedRows();
			revertSnapshotEntry(previousSnapshots);
			this.errorMessage = "Couldn't update that — try again.";
		} else {
			this.errorMessage = null;
		}
	}
}
