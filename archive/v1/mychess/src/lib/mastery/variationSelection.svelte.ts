// mychess/src/lib/mastery/variationSelection.svelte.ts
/* eslint-disable svelte/prefer-svelte-reactivity --
   Every Map/Set here is deliberately NON-reactive. `#snapshots` says so in its
   own doc comment below (nothing renders from it — only `toggleGroup` reads
   it), and the rest are short-lived locals inside a single method call
   (`originalIncludedByKey`, `rowKeys`, `nextSnapshots`). SvelteMap/SvelteSet
   would add reactive-graph bookkeeping for values nothing tracks. This file
   was never actually linted before #91 fixed the `.svelte.ts` parser config,
   which is why the rule only surfaces now. */
import type { VariationStep } from './variations';

export type VariationRow = {
	variationKey: string;
	label: string;
	// One entry per chapter this line belongs to (UNTAGGED_CHAPTER's own single
	// entry for a genuinely untagged line) — GitHub issue #86. Independent per
	// chapter: excluding this line under one chapter's view leaves its entry
	// under any other chapter it belongs to untouched.
	includedByChapter: Record<string, boolean>;
	// Every chapter this line belongs to — a line cross-referenced by two
	// chapters shows (and toggles) under both. Empty means untagged, which
	// gets its own UNTAGGED_CHAPTER bucket inside a chaptered repertoire.
	chapterNames: string[];
	path: VariationStep[];
	solved: boolean;
};

/**
 * Whether `row` is included from the perspective of `chapter` — the tri-state
 * checkbox tree's own chapter/move-group/leaf-variation tier reads this to
 * decide its checked state.
 *
 * `chapter: null` means "truly included in practice at all" (the repertoire-
 * level checkbox's own scope, and the flat/chapterless pool's implicit single
 * tier, which happens to coincide with it — a row in a chapterless repertoire
 * carries exactly one entry, so "any chapter still includes it" and "that one
 * entry" are the same question). Any other value looks up that one chapter's
 * own entry directly.
 */
export function isIncludedFor(row: VariationRow, chapter: string | null): boolean {
	if (chapter === null) return Object.values(row.includedByChapter).some(Boolean);
	return row.includedByChapter[chapter] ?? true;
}

/**
 * `row` with `chapter`'s own entry (or, for `chapter: null`, EVERY entry —
 * the repertoire-level "everything" scope) set to `included`. Used for both
 * the optimistic local update on toggle and its revert on a failed write.
 */
function withIncluded(row: VariationRow, chapter: string | null, included: boolean): VariationRow {
	if (chapter === null) {
		const next: Record<string, boolean> = {};
		for (const key of Object.keys(row.includedByChapter)) next[key] = included;
		return { ...row, includedByChapter: next };
	}
	if (!(chapter in row.includedByChapter)) return row;
	return { ...row, includedByChapter: { ...row.includedByChapter, [chapter]: included } };
}

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

	async #postExclusion(variationKeys: string[], included: boolean, chapter: string | null): Promise<boolean> {
		try {
			const res = await fetch(`/api/repertoires/${this.#repertoireId()}/exclusions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys, included, chapter })
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Toggles one variation, scoped to `chapter` — the chapter/move-group
	 * subtree it's rendered under (`null` for the repertoire-level "everything"
	 * scope, or the flat pool's own implicit single tier; see `isIncludedFor`).
	 * A line shared by two chapters has an independent checkbox under each —
	 * toggling it under chapter A never touches its own entry under chapter B.
	 */
	async toggleVariation(key: string, chapter: string | null) {
		try {
			await this.ensureLoaded();
		} catch {
			return;
		}
		const current = this.variations!;
		const target = current.find((v) => v.variationKey === key);
		if (!target) return;
		const wasIncluded = isIncludedFor(target, chapter);
		const nextIncluded = !wasIncluded;
		this.variations = current.map((v) => (v.variationKey === key ? withIncluded(v, chapter, nextIncluded) : v));
		const ok = await this.#postExclusion([key], nextIncluded, chapter);
		if (!ok) {
			// Revert only this one row, applied on top of whatever `variations`
			// is NOW rather than the stale snapshot captured above — another
			// toggle elsewhere may have completed while this request was in
			// flight, and that change must survive this one's failure.
			this.variations = (this.variations ?? []).map((v) =>
				v.variationKey === key ? withIncluded(v, chapter, wasIncluded) : v
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
	 *
	 * `chapter` scopes both the read (which rows in `belongsToGroup` count as
	 * already included) and the write (which entry in each touched row's
	 * `includedByChapter` actually flips) — `null` for the repertoire-level
	 * checkbox, a real chapter/move-group's own name otherwise. See
	 * `isIncludedFor`/`withIncluded`.
	 */
	async toggleGroup(scopeKey: string, belongsToGroup: (row: VariationRow) => boolean, chapter: string | null) {
		try {
			await this.ensureLoaded();
		} catch {
			return;
		}
		const current = this.variations!;
		const rows = current.filter(belongsToGroup);
		const originalIncludedByKey = new Map(rows.map((v) => [v.variationKey, isIncludedFor(v, chapter)]));

		const revertTouchedRows = () => {
			this.variations = (this.variations ?? []).map((v) => {
				const original = originalIncludedByKey.get(v.variationKey);
				return original === undefined ? v : withIncluded(v, chapter, original);
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

		// Only a fully-checked scope (or an empty one, which renders as the
		// same 'checked' aggregate) excludes on click. A partially-checked
		// (indeterminate) scope selects everything instead — clicking a
		// partial parent checkbox is expected to mean "everything under me,"
		// not "exclude whatever's still included."
		const allIncluded = rows.length > 0 && rows.every((v) => isIncludedFor(v, chapter));
		if (rows.length === 0 || allIncluded) {
			// Fully checked -> bulk-exclude this scope's rows, remembering
			// exactly which ones were included (always all of them, since
			// this branch only runs when every row in scope is) so a
			// re-check can restore them.
			const included = rows.filter((v) => isIncludedFor(v, chapter)).map((v) => v.variationKey);
			const previousSnapshots = this.#snapshots;
			this.#snapshots = new Map(this.#snapshots).set(scopeKey, new Set(included));
			this.variations = current.map((v) => (belongsToGroup(v) ? withIncluded(v, chapter, false) : v));
			const ok = await this.#postExclusion(included, false, chapter);
			if (!ok) {
				revertTouchedRows();
				revertSnapshotEntry(previousSnapshots);
				this.errorMessage = "Couldn't update that — try again.";
			} else {
				this.errorMessage = null;
			}
			return;
		}

		// Unchecked or indeterminate -> select everything in scope: restore
		// the pre-uncheck selection if we have one from this visit (which, since
		// the exclude branch above only ever fires from a fully-checked scope,
		// is always "every row" anyway), otherwise default to including
		// everything in scope directly.
		const rowKeys = new Set(rows.map((v) => v.variationKey));
		const toInclude = this.#snapshots.get(scopeKey) ?? rowKeys;
		const previousSnapshots = this.#snapshots;
		this.variations = current.map((v) => (belongsToGroup(v) ? withIncluded(v, chapter, toInclude.has(v.variationKey)) : v));
		const nextSnapshots = new Map(this.#snapshots);
		nextSnapshots.delete(scopeKey);
		this.#snapshots = nextSnapshots;
		const ok = await this.#postExclusion([...toInclude], true, chapter);
		if (!ok) {
			revertTouchedRows();
			revertSnapshotEntry(previousSnapshots);
			this.errorMessage = "Couldn't update that — try again.";
		} else {
			this.errorMessage = null;
		}
	}
}
