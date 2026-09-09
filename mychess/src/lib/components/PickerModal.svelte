<!--
	mychess/src/lib/components/PickerModal.svelte

	Shared chrome for the opening pickers (GitHub issue #204): backdrop,
	panel, header/heading/close button, and the accessibility behaviour
	neither picker had — `role="dialog"`/`aria-modal`, a focus trap, focus
	moved in on open and restored on close, and Escape-to-close. Fixing it
	here fixes both pickers at once instead of a third copy-paste.

	Deliberately just the shell: it knows nothing about ECO codes, curated
	openings, or `use:enhance` — each picker still owns its own search/list/
	submit logic and its own "close only on a successful save" rule. See
	OpeningPicker.svelte and CuratedOpeningPicker.svelte.

	The assign-players modal inline in
	`(coach)/coach/repertoires/+page.svelte` is a separate third modal the
	issue explicitly left as a judgement call for later — not adopted here.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    heading,
    closeLabel,
    onclose,
    children
  }: {
    heading: string;
    closeLabel: string;
    onclose: () => void;
    children: Snippet;
  } = $props();

  let panelEl: HTMLDivElement | undefined = $state();
  // Whoever had focus before this modal opened, so it can be given back on
  // close — a coach tabbing from a picker back into the page they were on
  // shouldn't land at the top of the document.
  let previouslyFocused: HTMLElement | null = null;

  function focusableElements(): HTMLElement[] {
    if (!panelEl) return [];
    return Array.from(
      panelEl.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }

  // Single window-level listener rather than one on the panel: Escape must
  // work regardless of what inside the modal currently has focus, and the
  // Tab trap needs to see every Tab keystroke while the modal is open, not
  // just ones that started inside it.
  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusable = focusableElements();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeIsInside = panelEl?.contains(document.activeElement) ?? false;

    if (e.shiftKey) {
      if (!activeIsInside || document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (!activeIsInside || document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  $effect(() => {
    previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = focusableElements();
    (focusable[0] ?? panelEl)?.focus();

    return () => {
      previouslyFocused?.focus?.();
    };
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
  data-testid="picker-modal-backdrop"
  onclick={onclose}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    bind:this={panelEl}
    role="dialog"
    aria-modal="true"
    aria-label={heading}
    tabindex="-1"
    class="bg-(--color-surface) rounded-xl shadow-lg max-w-sm w-full max-h-[80vh] overflow-y-auto"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="flex items-center justify-between p-4 border-b border-gray-100">
      <h2 class="font-semibold text-(--color-text)">{heading}</h2>
      <button
        type="button"
        onclick={onclose}
        aria-label={closeLabel}
        class="text-(--color-muted) hover:text-gray-600 dark:hover:text-gray-400 text-xl leading-none"
      >
        &times;
      </button>
    </div>

    <div class="p-4">
      {@render children()}
    </div>
  </div>
</div>
