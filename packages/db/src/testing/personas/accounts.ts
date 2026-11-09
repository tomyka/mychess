/**
 * The persona accounts and how they are linked: the "Seed data" tables of
 * docs/personas/*.md (M1 rows). Pure data.
 */
import type { Profile } from '@mychess/domain';

export type PersonaKey =
  'coach' | 'coach2' | 'u1400' | '1400-2000' | '2000plus';

export interface PersonaAccount {
  readonly key: PersonaKey;
  /** `persona-<key>@mychess.test`: the test sign-in's domain (R-73). */
  readonly email: string;
  readonly profile: Profile;
  /** Coach mode on since `since`. */
  readonly coach: boolean;
  /** When the account was made and onboarded. */
  readonly since: Date;
}

/** A date of the docs at 09:00 UTC, the hour the seed's dated events happen. */
export const on = (date: string): Date => new Date(`${date}T09:00:00Z`);

const account = (
  key: PersonaKey,
  profile: Profile,
  since: string,
  coach = false,
): PersonaAccount => ({
  key,
  email: `persona-${key}@mychess.test`,
  profile,
  coach,
  since: on(since),
});

/**
 * In the order they are made; removed players first, so deleting a coach
 * never has to fork anything for a persona (R-49).
 */
export const PERSONA_ACCOUNTS: readonly PersonaAccount[] = [
  // The earliest date the docs give the coach: Dovydas joins the group then.
  account(
    'coach',
    { displayName: 'Rimantas Vaitkus', locale: 'lt' },
    '2025-11-20',
    true,
  ),
  // The docs give no date for the second coach (seed assumption).
  account(
    'coach2',
    { displayName: 'Aistė Markevičienė', locale: 'lt' },
    '2026-09-01',
    true,
  ),
  account(
    '2000plus',
    { displayName: 'Dovydas Jankauskas', locale: 'en' },
    '2025-11-20',
    true,
  ),
  account(
    '1400-2000',
    { displayName: 'Gabija Navickaitė', locale: 'lt' },
    '2026-02-01',
  ),
  account(
    'u1400',
    { displayName: 'Rokas Petrauskas', locale: 'lt' },
    '2026-04-12',
  ),
];

export const PERSONA_GROUP = {
  coach: 'coach',
  name: 'Šeštadienio grupė',
  createdAt: on('2025-11-20'),
} as const satisfies {
  readonly coach: PersonaKey;
  readonly name: string;
  readonly createdAt: Date;
};

/** A coach link, accepted through an invite on `at`. */
export interface PersonaLink {
  readonly coach: PersonaKey;
  readonly player: PersonaKey;
  readonly at: Date;
  /** Joined PERSONA_GROUP with the link (a group invite). */
  readonly inGroup: boolean;
}

export const PERSONA_LINKS: readonly PersonaLink[] = [
  { coach: 'coach', player: '2000plus', at: on('2025-11-20'), inGroup: true },
  { coach: 'coach', player: '1400-2000', at: on('2026-02-01'), inGroup: true },
  { coach: 'coach', player: 'u1400', at: on('2026-04-12'), inGroup: true },
  // The docs give no date for this link (seed assumption).
  {
    coach: 'coach2',
    player: '1400-2000',
    at: on('2026-09-01'),
    inGroup: false,
  },
];
