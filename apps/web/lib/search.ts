// Unicode combining diacritical marks (U+0300-U+036F) left behind by NFD
// decomposition (e.g. "u" + combining acute) -- stripped so comparisons run
// purely on base letters.
const COMBINING_DIACRITICS = /[\u0300-\u036f]/g;

/**
 * Shared normalization for every listing's search box -- case-insensitive,
 * tolerant of leading/trailing spaces, and accent-insensitive (busqueda ==
 * "busqueda" with an accent) so "Mejo" finds "MejoReferido" regardless of
 * how either side was typed/accented.
 */
export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(COMBINING_DIACRITICS, '');
}

/** True if `query` is empty, or `candidates` contains it as a substring (after normalization). */
export function matchesSearch(query: string, ...candidates: (string | null | undefined)[]): boolean {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return candidates.some((candidate) => candidate && normalizeSearchText(candidate).includes(needle));
}
