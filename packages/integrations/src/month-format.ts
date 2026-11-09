/**
 * A dump month as `YYYY-MM`, as a regular expression source: the format of
 * the domain's MONTH_PATTERN (`@mychess/domain` broadcast-month.ts), which
 * this package may not import. The domain parses the month again before it
 * is stored.
 */
export const MONTH_FORMAT = '[0-9]{4}-(?:0[1-9]|1[0-2])';
