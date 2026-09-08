// mychess/src/lib/components/reactive-props.svelte.ts
//
// Wraps a plain props object in `$state` so a test can mutate ONE prop on a
// mounted component and have the component react, the way its real parent
// does. Needed because `@testing-library/svelte`'s `rerender` re-mounts:
// mount-time effects run again, so a fetch-on-change assertion passes even
// when the dependency it claims to prove has been removed. Runes only work in
// a `.svelte.ts` module, hence this file rather than an inline helper.
export function reactiveProps<T extends object>(initial: T): T {
	const props = $state(initial);
	return props;
}
