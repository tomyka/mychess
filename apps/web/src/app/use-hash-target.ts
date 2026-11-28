import { useEffect, useRef, type RefObject } from 'react';

/**
 * A section the address can name (`#id`), brought into view on mount when
 * the address names it and the page is still at the top (#403). On a hard
 * reload the browser scrolls to the hash as soon as the first HTML is in:
 * a page that streams behind a loading.tsx has no such element yet, so
 * the browser stays at the top. A page already scrolled, by the browser or
 * the reader, is left where it is. The element's scroll margin decides
 * where it lands.
 */
export function useHashTarget<T extends HTMLElement>(
  id: string,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (window.location.hash !== `#${id}` || window.scrollY !== 0) return;
    ref.current?.scrollIntoView();
  }, [id]);
  return ref;
}
