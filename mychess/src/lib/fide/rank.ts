export type AgeBracket = 'U8' | 'U10' | 'U12' | 'U14' | 'U16' | 'U18' | 'U20' | '50+' | '65+' | 'open';

export function ageBracket(birthYear: number | null, currentYear: number): AgeBracket | null {
  if (birthYear == null) return null;
  const age = currentYear - birthYear;
  if (age <= 8) return 'U8';
  if (age <= 10) return 'U10';
  if (age <= 12) return 'U12';
  if (age <= 14) return 'U14';
  if (age <= 16) return 'U16';
  if (age <= 18) return 'U18';
  if (age <= 20) return 'U20';
  if (age >= 65) return '65+';
  if (age >= 50) return '50+';
  return 'open';
}
