// Current European Chess Union (ECU) membership — 54 federations, per
// europechess.org/federations (checked Aug 2026). Russia is deliberately
// excluded despite FIDE's historical "Europe zone" grouping: it has been
// suspended from the ECU since 2022, and its large rated population would
// otherwise materially shift every other federation's Europe rank.
export const EUROPEAN_FEDERATIONS: ReadonlySet<string> = new Set([
  'ALB', 'AND', 'ARM', 'AUT', 'AZE', 'BLR', 'BEL', 'BIH', 'BUL', 'CRO',
  'CYP', 'CZE', 'DEN', 'ENG', 'EST', 'FAI', 'FIN', 'FRA', 'GEO', 'GER',
  'GRE', 'GCI', 'HUN', 'ISL', 'IRL', 'ISR', 'ITA', 'JCI', 'KOS', 'LAT',
  'LIE', 'LTU', 'LUX', 'MLT', 'MDA', 'MNC', 'MNE', 'NED', 'MKD', 'NOR',
  'POL', 'POR', 'ROU', 'SMR', 'SCO', 'SRB', 'SVK', 'SLO', 'ESP', 'SWE',
  'SUI', 'TUR', 'UKR', 'WLS'
]);

export function isEuropeanFederation(federation: string): boolean {
  return EUROPEAN_FEDERATIONS.has(federation);
}
