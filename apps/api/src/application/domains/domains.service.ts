import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { Domain, UpdateDomainInput } from '../../domain/domain-entity/domain.entity';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import {
  AUDIT_LOG_REPOSITORY,
  CONVERSATION_REPOSITORY,
  DOMAIN_REPOSITORY,
  MAILBOX_REPOSITORY,
  SEQUENCE_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { ClientsService } from '../clients/clients.service';
import { CreateDomainPayload, DomainSummary, UpdateDomainPayload } from './domains.types';

@Injectable()
export class DomainsService {
  constructor(
    @Inject(DOMAIN_REPOSITORY) private readonly domains: DomainRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly clients: ClientsService,
  ) {}

  async listByClient(organizationId: string, clientId: string): Promise<DomainSummary[]> {
    const client = await this.clients.getOwnedClient(organizationId, clientId);
    const rows = await this.domains.findByClient(organizationId, clientId);
    return Promise.all(rows.map((row) => this.toSummary(row, client.name)));
  }

  async getById(organizationId: string, domainId: string): Promise<DomainSummary> {
    const domain = await this.getOwnedDomain(organizationId, domainId);
    const client = await this.clients.getOwnedClient(organizationId, domain.clientId);
    return this.toSummary(domain, client.name);
  }

  /** "Mis clientes → dominio" — domains inherit visibility from their parent client's assignment. */
  async listByClientForExecutive(
    organizationId: string,
    userId: string,
    clientId: string,
  ): Promise<DomainSummary[]> {
    await this.clients.requireAssignedClient(userId, clientId);
    return this.listByClient(organizationId, clientId);
  }

  async getByIdForExecutive(
    organizationId: string,
    userId: string,
    domainId: string,
  ): Promise<DomainSummary> {
    const domain = await this.getOwnedDomain(organizationId, domainId);
    await this.clients.requireAssignedClient(userId, domain.clientId);
    const client = await this.clients.getOwnedClient(organizationId, domain.clientId);
    return this.toSummary(domain, client.name);
  }

  async create(
    organizationId: string,
    clientId: string,
    input: CreateDomainPayload,
    actorId: string,
  ): Promise<DomainSummary> {
    const client = await this.clients.getOwnedClient(organizationId, clientId);
    await this.clients.assertClientCrmEligible(organizationId, clientId, actorId);
    const domainName = input.domainName.trim().toLowerCase();

    // Unique per organization, not globally — different organizations
    // (tenants) are fully isolated in this codebase already, and nothing
    // about the client-hierarchy pivot changes that; there's no scenario
    // here where two orgs legitimately share one Mr Outreach tenant, so a
    // per-org uniqueness check is the right scope (see domain.entity.ts).
    const existing = await this.domains.findByName(organizationId, domainName);
    if (existing) {
      throw new ConflictException('A domain with this name already exists in the organization.');
    }

    const domain = await this.domains.create({
      organizationId,
      clientId: client.id,
      domainName,
      notes: input.notes ?? null,
      createdBy: actorId,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'domain.create',
      entityType: 'Domain',
      entityId: domain.id,
      metadata: { clientId: client.id, domainName: domain.domainName },
    });

    return this.toSummary(domain, client.name);
  }

  async update(
    organizationId: string,
    domainId: string,
    input: UpdateDomainPayload,
    actorId: string,
  ): Promise<DomainSummary> {
    const existing = await this.getOwnedDomain(organizationId, domainId);

    // §9 — only gate when this update reactivates the domain (habilita
    // nueva actividad); purely descriptive edits (name/notes) or moving
    // to INACTIVE/ARCHIVED never depend on the CRM.
    const isReactivating = input.status === 'ACTIVE' && existing.status !== 'ACTIVE';
    if (isReactivating) {
      await this.clients.assertClientCrmEligible(organizationId, existing.clientId, actorId);
    }

    const domainName = input.domainName?.trim().toLowerCase();

    if (domainName && domainName !== existing.domainName.toLowerCase()) {
      const conflict = await this.domains.findByName(organizationId, domainName);
      if (conflict) {
        throw new ConflictException('A domain with this name already exists in the organization.');
      }
    }

    // Never spread `undefined` fields into the repository call: an explicit
    // `{ domainName: undefined }` would overwrite the existing value in the
    // in-memory adapter's `{ ...existing, ...input }` merge.
    const patch: UpdateDomainInput = { updatedBy: actorId };
    if (domainName !== undefined) patch.domainName = domainName;
    if (input.status !== undefined) patch.status = input.status;
    if (input.notes !== undefined) patch.notes = input.notes;

    const updated = await this.domains.update(existing.id, patch);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: input.status !== undefined ? 'domain.status_change' : 'domain.update',
      entityType: 'Domain',
      entityId: domainId,
      metadata: input.status !== undefined ? { status: input.status } : undefined,
    });

    const client = await this.clients.getOwnedClient(organizationId, updated.clientId);
    return this.toSummary(updated, client.name);
  }

  async remove(organizationId: string, domainId: string, actorId: string): Promise<void> {
    const existing = await this.getOwnedDomain(organizationId, domainId);
    await this.domains.update(existing.id, {
      status: 'ARCHIVED',
      deletedAt: new Date(),
      updatedBy: actorId,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'domain.delete',
      entityType: 'Domain',
      entityId: domainId,
    });
  }

  /** Same 404-not-403 rule as every other resource in this API. */
  async getOwnedDomain(organizationId: string, domainId: string): Promise<Domain> {
    const domain = await this.domains.findById(domainId);
    if (!domain || domain.organizationId !== organizationId) {
      throw new NotFoundException('Domain not found.');
    }
    return domain;
  }

  private async toSummary(domain: Domain, clientName: string): Promise<DomainSummary> {
    const allMailboxes = await this.mailboxes.findAll(domain.organizationId);
    const domainMailboxes = allMailboxes.filter((m) => m.domainId === domain.id);
    const domainMailboxIds = new Set(domainMailboxes.map((m) => m.id));

    const clientSequences = await this.sequences.findByClient(
      domain.organizationId,
      domain.clientId,
    );
    const sequenceCount = clientSequences.filter(
      (sequence) => sequence.mailboxId && domainMailboxIds.has(sequence.mailboxId),
    ).length;

    const [statusNew, statusPending, statusInProgress] = await Promise.all([
      this.conversations.findAll(domain.organizationId, {
        domainId: domain.id,
        managementStatus: 'NEW',
      }),
      this.conversations.findAll(domain.organizationId, {
        domainId: domain.id,
        managementStatus: 'PENDING',
      }),
      this.conversations.findAll(domain.organizationId, {
        domainId: domain.id,
        managementStatus: 'IN_PROGRESS',
      }),
    ]);

    return {
      id: domain.id,
      organizationId: domain.organizationId,
      clientId: domain.clientId,
      clientName,
      domainName: domain.domainName,
      status: domain.status,
      notes: domain.notes,
      mailboxCount: domainMailboxes.length,
      sequenceCount,
      newConversationCount: statusNew.length,
      pendingConversationCount: statusNew.length + statusPending.length + statusInProgress.length,
      createdAt: domain.createdAt,
      updatedAt: domain.updatedAt,
    };
  }
}
