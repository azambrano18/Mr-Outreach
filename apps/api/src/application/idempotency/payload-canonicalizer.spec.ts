import { hashLogicalPayload } from './payload-canonicalizer';

describe('hashLogicalPayload', () => {
  it('is deterministic for the same payload', () => {
    const payload = { a: 1, b: 'two', c: true };
    expect(hashLogicalPayload(payload)).toBe(hashLogicalPayload({ ...payload }));
  });

  it('produces the same hash regardless of property order', () => {
    const a = { first: 'x', second: 'y', third: { nested: 1, other: 2 } };
    const b = { third: { other: 2, nested: 1 }, second: 'y', first: 'x' };
    expect(hashLogicalPayload(a)).toBe(hashLogicalPayload(b));
  });

  it('produces a different hash for a different payload', () => {
    expect(hashLogicalPayload({ a: 1 })).not.toBe(hashLogicalPayload({ a: 2 }));
  });

  it('normalizes Date values to ISO strings, independent of object identity', () => {
    const when = new Date('2026-01-01T10:00:00.000Z');
    const a = { startAt: when };
    const b = { startAt: new Date(when.getTime()) };
    expect(hashLogicalPayload(a)).toBe(hashLogicalPayload(b));
  });

  it('never encodes undefined as the literal string "undefined"', () => {
    const withUndefined = { a: 1, b: undefined };
    const withoutKey = { a: 1 };
    expect(hashLogicalPayload(withUndefined)).toBe(hashLogicalPayload(withoutKey));
  });

  it('distinguishes null from a missing key (never conflates the two)', () => {
    expect(hashLogicalPayload({ a: null })).not.toBe(hashLogicalPayload({}));
  });

  it('hashes arrays element-wise, order-sensitive', () => {
    expect(hashLogicalPayload({ items: [1, 2, 3] })).not.toBe(hashLogicalPayload({ items: [3, 2, 1] }));
  });
});
