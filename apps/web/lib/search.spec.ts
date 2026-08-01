import { matchesSearch, normalizeSearchText } from './search';

describe('normalizeSearchText', () => {
  it('lowercases and trims', () => {
    expect(normalizeSearchText('  Ventas  ')).toBe('ventas');
  });

  it('strips accents so accented and unaccented text compare equal', () => {
    expect(normalizeSearchText('Búsqueda')).toBe('busqueda');
    expect(normalizeSearchText('busqueda')).toBe('busqueda');
  });
});

describe('matchesSearch', () => {
  it('returns true for every candidate when the query is empty', () => {
    expect(matchesSearch('', 'MejoReferido')).toBe(true);
    expect(matchesSearch('   ', 'MejoReferido')).toBe(true);
  });

  it('matches a partial, case-insensitive substring — "Mejo" finds "MejoReferido"', () => {
    expect(matchesSearch('Mejo', 'MejoReferido')).toBe(true);
    expect(matchesSearch('mejo', 'MejoReferido')).toBe(true);
    expect(matchesSearch('MEJO', 'MejoReferido')).toBe(true);
  });

  it('matches an email by a partial fragment — "ventas" finds "ventas@empresa.cl"', () => {
    expect(matchesSearch('ventas', 'ventas@empresa.cl')).toBe(true);
  });

  it('matches a domain fragment across a full email — "empresa.cl" finds "ventas@empresa.cl"', () => {
    expect(matchesSearch('empresa.cl', 'ventas@empresa.cl')).toBe(true);
  });

  it('checks every candidate field, matching if any one of them matches', () => {
    expect(matchesSearch('empresa.cl', 'Sin cliente', 'ventas@empresa.cl', null)).toBe(true);
  });

  it('is tolerant of surrounding whitespace in the query', () => {
    expect(matchesSearch('  mejo  ', 'MejoReferido')).toBe(true);
  });

  it('is accent-insensitive between query and candidate', () => {
    expect(matchesSearch('jose', 'José Pérez')).toBe(true);
    expect(matchesSearch('José', 'jose perez')).toBe(true);
  });

  it('ignores null/undefined candidates without throwing', () => {
    expect(matchesSearch('mejo', null, undefined, 'MejoReferido')).toBe(true);
    expect(() => matchesSearch('mejo', null, undefined)).not.toThrow();
  });

  it('returns false when no candidate contains the query', () => {
    expect(matchesSearch('inexistente', 'MejoReferido', 'ventas@empresa.cl')).toBe(false);
  });
});
