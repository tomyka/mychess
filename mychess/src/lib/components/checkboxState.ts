// mychess/src/lib/components/checkboxState.ts

/** A checkbox that aggregates several rows is one of three states, not a boolean. */
export type TriState = 'checked' | 'unchecked' | 'indeterminate';

/**
 * Checked/unchecked/indeterminate aggregate for an arbitrary subset of
 * togglable rows, given each row's own included state — resolved by the
 * caller (e.g. `isIncludedFor(row, chapter)`) rather than read directly off
 * the row, since "included" is chapter-relative (see `variationSelection`).
 */
export function aggregateState(included: boolean[]): TriState {
	if (included.length === 0) return 'checked';
	const includedCount = included.filter(Boolean).length;
	return includedCount === included.length ? 'checked' : includedCount === 0 ? 'unchecked' : 'indeterminate';
}

/**
 * Imperatively owns BOTH `checked` and `indeterminate` on a parent/group
 * checkbox, bypassing Svelte's normal one-way `checked={...}` diffing —
 * which only re-touches the DOM when the JS-computed value differs from
 * whatever Svelte itself last assigned. Clicking a native indeterminate
 * checkbox flips its real DOM `checked` to `true` before any of our own
 * code runs; if the resulting aggregate state (e.g. going from
 * 'indeterminate' straight to 'unchecked', both of which map to
 * `checked: false`) computes the SAME `checked` value Svelte last set,
 * Svelte sees no change and skips the DOM write — leaving the checkbox
 * visibly stuck checked even though every child row is correctly
 * unselected. Setting both properties directly, every time, avoids that
 * stale-diff gap entirely.
 *
 * Shared by every tri-state checkbox in the practice picker (the
 * repertoire-level one in `RepertoirePracticeRow`, plus the chapter and
 * move-group ones in `RepertoireVariationTree`) so none of them can drift
 * back to a plain `checked={...}` binding and reintroduce the bug.
 */
export function checkboxState(node: HTMLInputElement, state: TriState) {
	function apply(next: TriState) {
		node.checked = next === 'checked';
		node.indeterminate = next === 'indeterminate';
	}
	apply(state);
	return { update: apply };
}
