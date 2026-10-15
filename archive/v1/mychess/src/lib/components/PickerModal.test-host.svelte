<!--
	Test-only harness for PickerModal.test.ts.

	Snippet-typed `children` props can't be constructed from a plain .ts test
	file — they're template syntax the Svelte compiler lowers into a function —
	so tests render this thin host instead of PickerModal directly, passing
	the same props through and supplying real markup as children. Two
	focusable children (a button and a link) so the focus-trap tests have
	somewhere other than the close button to land.
-->
<script lang="ts">
  import PickerModal from './PickerModal.svelte';

  let {
    heading,
    closeLabel,
    onclose
  }: { heading: string; closeLabel: string; onclose: () => void } = $props();
</script>

<PickerModal {heading} {closeLabel} {onclose}>
  <button type="button" data-testid="picker-modal-child">child button</button>
  <a href="#somewhere" data-testid="picker-modal-child-link">child link</a>
</PickerModal>
