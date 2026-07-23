/**
 * Normalized company — §29. Contacts reference `companyId` instead of a
 * free-text company name, but the original text a user typed/imported is
 * always kept too (`rawName`), since normalization is lossy and manual
 * correction needs something to show the user what they actually entered.
 */
export interface Company {
  id: string;
  organizationId: string;
  clientId: string;
  rawName: string;
  /** Lowercased, whitespace-collapsed — the matching key for "possible duplicate" hints, never auto-merged. */
  normalizedName: string;
  /** §30 — global exclusion, distinct from "removed from one sequence" (SequenceContact.status). Blocks future enrollment in ANY sequence. */
  suppressed: boolean;
  suppressedAt: Date | null;
  suppressedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateCompanyInput {
  organizationId: string;
  clientId: string;
  rawName: string;
}

export interface UpdateCompanyInput {
  suppressed?: boolean;
  suppressedAt?: Date | null;
  suppressedReason?: string | null;
}

/** Deterministic — same rule the import pipeline and the manual "create company" path both use, so results never depend on which path created a row. */
export function normalizeCompanyName(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,]/g, '')
    .replace(/\b(s\.?a\.?|sa|spa|ltda|inc|llc)\b/g, '')
    .trim();
}
