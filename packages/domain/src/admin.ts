/** The audited Admin actions (R-72, R-80); one audit row each. */
export const ADMIN_ACTIONS = ['grant-admin', 'disable-account'] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** Message-catalogue keys for Admin refusals; the CLI prints them. */
export const ADMIN_REFUSALS = {
  accountNotFound: 'admin.accountNotFound',
  alreadyDisabled: 'admin.alreadyDisabled',
} as const;

export interface AdminRefusal {
  readonly reason: (typeof ADMIN_REFUSALS)[keyof typeof ADMIN_REFUSALS];
}
