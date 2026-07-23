import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { IntegrationCommand } from '../../domain/integration/integration-command.entity';
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
import { IntegrationService } from '../integration/integration.service';
import { SchedulingService } from '../scheduling/scheduling.service';

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
 * §27-28 — "Retirar de esta secuencia" for a single contact or for every
 * contact of one company within ONE sequence (never a global exclusion by
 * itself — see Contact/Company.suppressed for that separate action, §30).
 * Both commands complete near-instantly in simulation (their planned event
 * lists are single-event), so — same choice as SequencePublishService —
 * this advances to completion synchronously instead of exposing a manual
 * step-by-step control.
 */
@Injectable()
export class SequenceContactsService {
  constructor(
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    private readonly integration: IntegrationService,
    private readonly scheduling: SchedulingService,
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

  async removeContact(
    organizationId: string,
    sequenceId: string,
    sequenceContactId: string,
    reason: string,
    actorId: string,
    idempotencyKey?: string,
  ): Promise<{ contact: SequenceContact; command: IntegrationCommand; duplicate: boolean; cancelledJobs: number }> {
    const contact = await this.getOwnedContact(organizationId, sequenceId, sequenceContactId);

    const { command, duplicate } = await this.integration.submit(
      {
        organizationId,
        commandType: 'SEQUENCE_CONTACT_REMOVE_REQUESTED',
        aggregateType: 'SEQUENCE_CONTACT',
        aggregateId: contact.id,
        payload: { sequenceId, sequenceContactId: contact.id, contactId: contact.contactId, reason },
        requestedBy: actorId,
        idempotencyKey: idempotencyKey ?? `sequence-contact-remove:${contact.id}:${randomUUID()}`,
      },
      actorId,
    );

    let cancelledJobs = 0;
    if (!duplicate) {
      await this.integration.advance(organizationId, command.commandId, 'ALL', actorId);
      cancelledJobs = await this.scheduling.cancelFutureJobsForContact(organizationId, contact.id, reason);
      await this.sequenceContacts.update(contact.id, {
        status: 'REMOVED',
        stoppedAt: new Date(),
        stopReason: reason,
      });
    }

    const updated = await this.getOwnedContact(organizationId, sequenceId, sequenceContactId);
    return { contact: updated, command, duplicate, cancelledJobs };
  }

  async removeCompany(
    organizationId: string,
    sequenceId: string,
    companyId: string,
    reason: string,
    actorId: string,
    idempotencyKey?: string,
  ): Promise<{ command: IntegrationCommand; duplicate: boolean; cancelledJobs: number; affectedContacts: number }> {
    const company = await this.companies.findById(companyId);
    if (!company || company.organizationId !== organizationId) {
      throw new NotFoundException('Company not found.');
    }

    const { command, duplicate } = await this.integration.submit(
      {
        organizationId,
        commandType: 'SEQUENCE_COMPANY_REMOVE_REQUESTED',
        aggregateType: 'SEQUENCE_COMPANY',
        aggregateId: companyId,
        payload: { sequenceId, companyId, reason },
        requestedBy: actorId,
        idempotencyKey: idempotencyKey ?? `sequence-company-remove:${sequenceId}:${companyId}:${randomUUID()}`,
      },
      actorId,
    );

    let cancelledJobs = 0;
    let affectedContacts = 0;
    if (!duplicate) {
      await this.integration.advance(organizationId, command.commandId, 'ALL', actorId);
      cancelledJobs = await this.scheduling.cancelFutureJobsForCompany(organizationId, sequenceId, companyId, reason);
      const contacts = await this.sequenceContacts.findBySequence(organizationId, sequenceId, { companyId });
      const stillActive = contacts.filter((contact) => contact.status !== 'REMOVED');
      await Promise.all(
        stillActive.map((contact) =>
          this.sequenceContacts.update(contact.id, {
            status: 'REMOVED',
            stoppedAt: new Date(),
            stopReason: reason,
          }),
        ),
      );
      affectedContacts = stillActive.length;
    }

    return { command, duplicate, cancelledJobs, affectedContacts };
  }

  private async getOwnedContact(
    organizationId: string,
    sequenceId: string,
    sequenceContactId: string,
  ): Promise<SequenceContact> {
    const contact = await this.sequenceContacts.findById(sequenceContactId);
    if (!contact || contact.organizationId !== organizationId || contact.sequenceId !== sequenceId) {
      throw new NotFoundException('Sequence contact not found.');
    }
    return contact;
  }
}
