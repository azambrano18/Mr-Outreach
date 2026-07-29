import { createHash } from 'node:crypto';

/**
 * Fase 2 — stable canonicalization for logical-payload hashing: object keys
 * sorted recursively, `undefined` values dropped (never encoded as the
 * literal string "undefined"/"null"), Dates normalized to ISO strings so
 * two equivalent payloads always hash identically regardless of property
 * order or Date-vs-ISO-string representation. Never used for anything
 * other than computing/comparing a hash — never returned to a caller.
 */
function canonicalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const canonicalValue = canonicalize((value as Record<string, unknown>)[key]);
      if (canonicalValue !== undefined) sorted[key] = canonicalValue;
    }
    return sorted;
  }
  return value;
}

/** SHA-256 (hex) of the canonicalized logical payload. Never include server-generated ids, timestamps or secrets in what's passed here — see each use case's own "hashable payload" builder. */
export function hashLogicalPayload(payload: Record<string, unknown>): string {
  const json = JSON.stringify(canonicalize(payload));
  return createHash('sha256').update(json).digest('hex');
}
