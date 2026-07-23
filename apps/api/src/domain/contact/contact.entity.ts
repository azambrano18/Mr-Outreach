export interface Contact {
  id: string;
  organizationId: string;
  clientId: string;
  companyId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** Used when only a single "full name" column was mapped instead of first/last. */
  fullName: string | null;
  jobTitle: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  linkedin: string | null;
  customFields: Record<string, string>;
  /** Global exclusion (§30) — distinct from being removed from a single sequence. */
  suppressed: boolean;
  suppressedAt: Date | null;
  suppressedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateContactInput {
  organizationId: string;
  clientId: string;
  companyId: string | null;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  website?: string | null;
  linkedin?: string | null;
  customFields?: Record<string, string>;
}

export interface UpdateContactInput {
  suppressed?: boolean;
  suppressedAt?: Date | null;
  suppressedReason?: string | null;
}
