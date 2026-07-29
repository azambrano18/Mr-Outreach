import { Inject, Injectable } from '@nestjs/common';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { SequenceContact } from '../../domain/sequence-contact/sequence-contact.entity';
import {
  SequenceContactFilter,
  SequenceContactRepository,
} from '../../domain/sequence-contact/sequence-contact.repository';
import {
  COMPANY_REPOSITORY,
  CONTACT_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
} from '../../infrastructure/persistence/tokens';

export interface SequenceContactSummary {
  id: string;
  contactId: string;
  email: string;
  fullName: string | null;
  companyId: string | null;
  companyName: string | null;
  currentStepPosition: number | null;
  status: SequenceContact['status'];
  nextScheduledAt: Date | null;
  lastSentAt: Date | null;
  repliedAt: Date | null;
  stoppedAt: Date | null;
  stopReason: string | null;
}

export interface SequenceCompanySummary {
  companyId: string;
  companyName: string;
  totalContacts: number;
  activeContacts: number;
  scheduledContacts: number;
  repliedContacts: number;
  completedContacts: number;
  removedContacts: number;
}

/**
 * §49-50 — read-side of "prospectos"/"empresas" for a sequence. The
 * "retirar" write actions moved to RemoveContactFromSequenceUseCase /
 * RemoveCompanyFromSequenceUseCase (Fase 2, Casos D/E) — transactional,
 * idempotent, replacing this service's former ad hoc removeContact()/
 * removeCompany() methods.
 */
@Injectable()
export class SequenceContactsService {
  constructor(
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
  ) {}

  /** §49 — "UI de prospectos de la secuencia". */
  async list(
    organizationId: string,
    sequenceId: string,
    filter?: SequenceContactFilter,
  ): Promise<SequenceContactSummary[]> {
    const rows = await this.sequenceContacts.findBySequence(organizationId, sequenceId, filter);
    return Promise.all(
      rows.map(async (row) => {
        const contact = await this.contacts.findById(row.contactId);
        const company = row.companyId ? await this.companies.findById(row.companyId) : null;
        return {
          id: row.id,
          contactId: row.contactId,
          email: contact?.email ?? '',
          fullName: contact?.fullName ?? ([contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || null),
          companyId: row.companyId,
          companyName: company?.rawName ?? null,
          currentStepPosition: row.currentStepPosition,
          status: row.status,
          nextScheduledAt: row.nextScheduledAt,
          lastSentAt: row.lastSentAt,
          repliedAt: row.repliedAt,
          stoppedAt: row.stoppedAt,
          stopReason: row.stopReason,
        };
      }),
    );
  }

  /** §50 — "UI de empresas", grouped with totals. */
  async listCompanies(organizationId: string, sequenceId: string): Promise<SequenceCompanySummary[]> {
    const rows = await this.sequenceContacts.findBySequence(organizationId, sequenceId);
    const byCompany = new Map<string, SequenceContact[]>();
    for (const row of rows) {
      if (!row.companyId) continue;
      const bucket = byCompany.get(row.companyId) ?? [];
      bucket.push(row);
      byCompany.set(row.companyId, bucket);
    }

    const summaries: SequenceCompanySummary[] = [];
    for (const [companyId, contacts] of byCompany.entries()) {
      const company = await this.companies.findById(companyId);
      summaries.push({
        companyId,
        companyName: company?.rawName ?? 'Empresa',
        totalContacts: contacts.length,
        activeContacts: contacts.filter((c) => c.status === 'ACTIVE').length,
        scheduledContacts: contacts.filter((c) => c.status === 'SCHEDULED').length,
        repliedContacts: contacts.filter((c) => c.status === 'REPLIED').length,
        completedContacts: contacts.filter((c) => c.status === 'COMPLETED').length,
        removedContacts: contacts.filter((c) => c.status === 'REMOVED').length,
      });
    }
    return summaries;
  }

}
