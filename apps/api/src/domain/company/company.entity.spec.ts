import { normalizeCompanyName } from './company.entity';

describe('normalizeCompanyName', () => {
  it('treats common company-name variants as equivalent', () => {
    expect(normalizeCompanyName('Vertex S.A.')).toBe(normalizeCompanyName('VERTEX'));
    expect(normalizeCompanyName('Vertex SA')).toBe(normalizeCompanyName('Vertex S.A.'));
    expect(normalizeCompanyName('  Vertex   S.A.  ')).toBe(normalizeCompanyName('Vertex SA'));
  });

  it('strips accents, punctuation and common legal suffixes', () => {
    expect(normalizeCompanyName('Ñandú Spa')).toBe('nandu');
    expect(normalizeCompanyName('Acme, Inc.')).toBe('acme');
  });

  it('does not collapse genuinely different companies', () => {
    expect(normalizeCompanyName('Vertex')).not.toBe(normalizeCompanyName('Vertexia'));
  });
});
