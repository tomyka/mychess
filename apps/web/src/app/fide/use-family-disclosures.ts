import { useState } from 'react';

/**
 * How many of a colour's groups start open: the first two in the domain's
 * order (most games first, unknown opening last), so a phone shows the main
 * lines at once and the rest as one-line summaries.
 */
const OPEN_GROUPS = 2;

/** Whether each family's group is open, by family ('' for the unknown one). */
type OpenByFamily = ReadonlyMap<string, boolean>;

export interface FamilyDisclosures {
  readonly isOpen: (family: string | null) => boolean;
  /** Keeps what the person did to a group: opened or closed it. */
  readonly toggled: (family: string | null, open: boolean) => void;
}

/** A family's group key: '' for the unknown opening. */
export const familyKey = (family: string | null): string => family ?? '';

/**
 * Whether each of a colour's family groups is open (#347). A group gets
 * its default (open among the first OPEN_GROUPS) the first time it is
 * shown and keeps it, or what the person did to it, while months are still
 * being prepared: new games reorder the groups, but none opens or closes
 * by itself.
 */
export function useFamilyDisclosures(
  families: readonly (string | null)[],
): FamilyDisclosures {
  const [opened, setOpened] = useState<OpenByFamily>(() =>
    withDefaults(new Map(), families),
  );
  const current = withDefaults(opened, families);
  // A family shown for the first time keeps its default from now on.
  if (current !== opened) setOpened(current);
  return {
    isOpen: (family) => current.get(familyKey(family)) === true,
    // A details element also fires toggle when its open attribute is
    // rendered; a toggle that changes nothing keeps the state as it is.
    toggled: (family, open) => {
      const key = familyKey(family);
      setOpened((previous) =>
        previous.get(key) === open
          ? previous
          : new Map(previous).set(key, open),
      );
    },
  };
}

/** `opened` with each family not seen before at its default; itself when none is new. */
function withDefaults(
  opened: OpenByFamily,
  families: readonly (string | null)[],
): OpenByFamily {
  const fresh = families
    .map((family, index) => [familyKey(family), index < OPEN_GROUPS] as const)
    .filter(([key]) => !opened.has(key));
  return fresh.length === 0 ? opened : new Map([...opened, ...fresh]);
}
