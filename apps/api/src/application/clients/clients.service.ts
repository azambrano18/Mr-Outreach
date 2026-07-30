import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientEligibilityService } from './client-eligibility.service';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ClientExecutiveAssignment } from '../../domain/client/client-executive-assignment.entity';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { ManagedClient } from '../../domain/client/managed-client.entity';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { TransactionContext } from '../../domain/persistence/transaction';
import { fullName, User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import {
  AUDIT_LOG_REPOSITORY,
  CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY,
  CONVERSATION_REPOSITORY,
  DOMAIN_REPOSITORY,
  MAILBOX_REPOSITORY,
  MANAGED_CLIENT_REPOSITORY,
  SEQUENCE_REPOSITORY,
  USER_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import {
  ClientAssigneeSummary,
  ManagedClientSummary,
  SetClientAssigneesPayload,
  UpdateManagedClientPayload,
} from './clients.types';

/** Minimal shape of the identity payload the external server hands over when a mailbox-link token is redeemed. */
export interface ServerClientPayload {
  serverClientId: string;
  name: string;
}

export interface ServerClientOperationalInput {
  legalName?: string;
  internalCode?: string;
  logoUrl?: string;
  startDate?: string;
  supervisorUserId?: string;
  notes?: string;
}

@Injectable()
export class ClientsService {
  constructor(
    @Inject(MANAGED_CLIENT_REPOSITORY) private readonly clients: ManagedClientRepository,
    @Inject(CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY)
    private readonly assignments: ClientExecutiveAssignmentRepository,
    @Inject(DOMAIN_REPOSITORY) private readonly domains: DomainRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly eligibility: ClientEligibilityService,
  ) {}

  async list(organizationId: string): Promise<ManagedClientSummary[]> {
    const rows = await this.clients.findAll(organizationId);
    return Promise.all(rows.map((row) => this.toSummary(row)));
  }

  /** Backs the executive's "Mis clientes" view — only clients they're assigned to. */
  async listForExecutive(organizationId: string, userId: string): Promise<ManagedClientSummary[]> {
    const userAssignments = await this.assignments.findByUser(userId);
    const clientIds = new Set(userAssignments.map((a) => a.clientId));
    const rows = await this.clients.findAll(organizationId);
    return Promise.all(
      rows.filter((row) => clientIds.has(row.id)).map((row) => this.toSummary(row)),
    );
  }

  async getById(organizationId: string, clientId: string): Promise<ManagedClientSummary> {
    const client = await this.getOwnedClient(organizationId, clientId);
    return this.toSummary(client);
  }

  /** 404s (never 403) if the client isn't assigned to this executive — same rule as every self-service resource in this API. */
  async getByIdForExecutive(
    organizationId: string,
    userId: string,
    clientId: string,
  ): Promise<ManagedClientSummary> {
    await this.requireAssignedClient(userId, clientId);
    return this.getById(organizationId, clientId);
  }

  /**
   * Creates or updates the local ManagedClient snapshot from a mailbox-link
   * token redemption — the only way a client's identity enters Mr
   * Outreach. Never fetches anything itself; the caller (LinkMailboxUseCase)
   * already has the verified payload from the external server. Corporate
   * fields (name) are always overwritten from the payload; every
   * operational field (legalName/internalCode/logoUrl/startDate/
   * supervisorUserId/notes) and every relation is left untouched on update
   * — only ever set on first creation, from `operationalInput` when given.
   */
  async upsertFromServerPayload(
    organizationId: string,
    payload: ServerClientPayload,
    actorId: string,
    operationalInput: ServerClientOperationalInput = {},
    ctx?: TransactionContext,
  ): Promise<ManagedClient> {
    const existing = await this.clients.findByServerClientId(organizationId, payload.serverClientId, ctx);
    if (existing) {
      const updated = await this.clients.update(existing.id, { name: payload.name, updatedBy: actorId }, ctx);
      await this.auditLogs.record(
        {
          organizationId,
          actorId,
          action: 'client.sync_from_link',
          entityType: 'ManagedClient',
          entityId: updated.id,
          metadata: { serverClientId: payload.serverClientId, name: payload.name },
        },
        ctx,
      );
      return updated;
    }

    const created = await this.clients.create(
      {
        organizationId,
        source: 'SERVER',
        serverClientId: payload.serverClientId,
        name: payload.name,
        legalName: operationalInput.legalName ?? null,
        internalCode: operationalInput.internalCode ?? null,
        logoUrl: operationalInput.logoUrl ?? null,
        startDate: operationalInput.startDate ? new Date(operationalInput.startDate) : null,
        supervisorUserId: operationalInput.supervisorUserId ?? null,
        notes: operationalInput.notes ?? null,
        createdBy: actorId,
      },
      ctx,
    );
    await this.auditLogs.record(
      {
        organizationId,
        actorId,
        action: 'client.create_from_link',
        entityType: 'ManagedClient',
        entityId: created.id,
        metadata: { serverClientId: payload.serverClientId, name: payload.name },
      },
      ctx,
    );
    return created;
  }

  /**
   * The single, reusable "may this client have new activity" gate, used
   * identically by domains/mailboxes/sequences and by both the admin and
   * executive flows (see each service's own call site).
   */
  async assertClientEligible(organizationId: string, managedClientId: string): Promise<void> {
    const client = await this.getOwnedClient(organizationId, managedClientId);
    this.eligibility.assertEligible(client);
  }

  async update(
    organizationId: string,
    clientId: string,
    input: UpdateManagedClientPayload,
    actorId: string,
  ): Promise<ManagedClientSummary> {
    const existing = await this.getOwnedClient(organizationId, clientId);

    const updated = await this.clients.update(existing.id, {
      legalName: input.legalName,
      internalCode: input.internalCode,
      status: input.status,
      logoUrl: input.logoUrl,
      startDate:
        input.startDate === undefined
          ? undefined
          : input.startDate
            ? new Date(input.startDate)
            : null,
      supervisorUserId: input.supervisorUserId,
      notes: input.notes,
      updatedBy: actorId,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: input.status !== undefined ? 'client.status_change' : 'client.update',
      entityType: 'ManagedClient',
      entityId: clientId,
      metadata: input.status !== undefined ? { status: input.status } : undefined,
    });

    return this.toSummary(updated);
  }

  async remove(organizationId: string, clientId: string, actorId: string): Promise<void> {
    const existing = await this.getOwnedClient(organizationId, clientId);
    await this.clients.update(existing.id, {
      status: 'ARCHIVED',
      deletedAt: new Date(),
      updatedBy: actorId,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'client.delete',
      entityType: 'ManagedClient',
      entityId: clientId,
    });
  }

  async getAssignees(organizationId: string, clientId: string): Promise<ClientAssigneeSummary[]> {
    await this.getOwnedClient(organizationId, clientId);
    const assignments = await this.assignments.findByClient(clientId);
    return this.toAssigneeSummaries(organizationId, assignments);
  }

  /** Same "replace the whole desired set in one call" pattern as MailboxesService.setAssignees. */
  async setAssignees(
    organizationId: string,
    clientId: string,
    input: SetClientAssigneesPayload,
    actorId: string,
  ): Promise<ClientAssigneeSummary[]> {
    const client = await this.getOwnedClient(organizationId, clientId);
    const secondaryUserIds = [...new Set(input.secondaryUserIds)].filter(
      (id) => id !== input.primaryUserId,
    );
    const desiredIds = input.primaryUserId
      ? [input.primaryUserId, ...secondaryUserIds]
      : secondaryUserIds;

    await Promise.all(
      desiredIds.map((userId) => this.requireAssignableUser(organizationId, userId)),
    );

    const current = await this.assignments.findByClient(client.id);
    const desired = new Set(desiredIds);
    const toRemove = current.filter((assignment) => !desired.has(assignment.userId));
    const currentIds = new Set(current.map((assignment) => assignment.userId));
    const isAddingSomeone = desiredIds.some((userId) => !currentIds.has(userId));

    // §9 — only gate NEW assignments; removing assignees from an inactive
    // client (e.g. offboarding) must always be allowed.
    if (isAddingSomeone) {
      await this.assertClientEligible(organizationId, clientId);
    }

    await Promise.all(
      toRemove.map((assignment) => this.assignments.remove(client.id, assignment.userId)),
    );
    if (input.primaryUserId) {
      await this.assignments.upsert({
        organizationId,
        clientId: client.id,
        userId: input.primaryUserId,
        role: 'PRIMARY',
        assignedBy: actorId,
      });
    }
    await Promise.all(
      secondaryUserIds.map((userId) =>
        this.assignments.upsert({
          organizationId,
          clientId: client.id,
          userId,
          role: 'SECONDARY',
          assignedBy: actorId,
        }),
      ),
    );

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'client.assign',
      entityType: 'ManagedClient',
      entityId: client.id,
      metadata: { primaryUserId: input.primaryUserId, secondaryUserIds },
    });

    return this.toAssigneeSummaries(organizationId, await this.assignments.findByClient(client.id));
  }

  /** 404s (never 403) for a client the executive isn't assigned to. */
  async requireAssignedClient(userId: string, clientId: string): Promise<void> {
    const userAssignments = await this.assignments.findByUser(userId);
    if (!userAssignments.some((assignment) => assignment.clientId === clientId)) {
      throw new NotFoundException('Client not found.');
    }
  }

  /** Same 404-not-403 rule as every other resource in this API. */
  async getOwnedClient(organizationId: string, clientId: string): Promise<ManagedClient> {
    const client = await this.clients.findById(clientId);
    if (!client || client.organizationId !== organizationId) {
      throw new NotFoundException('Client not found.');
    }
    return client;
  }

  private async requireAssignableUser(organizationId: string, userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user || user.organizationId !== organizationId) {
      throw new BadRequestException('Invalid user id.');
    }
    if (user.status !== 'ACTIVE') {
      throw new BadRequestException('No se pueden asignar ejecutivos inactivos.');
    }
    return user;
  }

  private async toAssigneeSummaries(
    organizationId: string,
    assignments: ClientExecutiveAssignment[],
  ): Promise<ClientAssigneeSummary[]> {
    const users = await Promise.all(
      assignments.map(async (assignment) => ({
        assignment,
        user: await this.users.findById(assignment.userId),
      })),
    );
    return users
      .filter(
        (row): row is { assignment: ClientExecutiveAssignment; user: User } =>
          !!row.user && row.user.organizationId === organizationId,
      )
      .map(({ assignment, user }) => ({
        id: user.id,
        name: fullName(user),
        email: user.email,
        status: user.status,
        role: assignment.role,
      }));
  }

  private async toSummary(client: ManagedClient): Promise<ManagedClientSummary> {
    const [clientDomains, allMailboxes, clientSequences, newConversations, pendingConversations] =
      await Promise.all([
        this.domains.findByClient(client.organizationId, client.id),
        this.mailboxes.findAll(client.organizationId),
        this.sequences.findByClient(client.organizationId, client.id),
        this.conversations.findAll(client.organizationId, {
          clientId: client.id,
          managementStatus: 'NEW',
        }),
        this.countPending(client.organizationId, client.id),
      ]);

    const mailboxCount = allMailboxes.filter((m) => m.clientId === client.id).length;

    return {
      id: client.id,
      organizationId: client.organizationId,
      source: client.source,
      serverClientId: client.serverClientId,
      name: client.name,
      legalName: client.legalName,
      internalCode: client.internalCode,
      industry: client.industry,
      status: client.status,
      logoUrl: client.logoUrl,
      startDate: client.startDate,
      supervisorUserId: client.supervisorUserId,
      notes: client.notes,
      clientRutSnapshot: client.clientRutSnapshot,
      externalStatusSnapshot: client.externalStatusSnapshot,
      externalStatusCheckedAt: client.externalStatusCheckedAt,
      domainCount: clientDomains.length,
      mailboxCount,
      sequenceCount: clientSequences.length,
      newConversationCount: newConversations.length,
      pendingConversationCount: pendingConversations,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }

  private async countPending(organizationId: string, clientId: string): Promise<number> {
    const [statusNew, statusPending, statusInProgress] = await Promise.all([
      this.conversations.findAll(organizationId, { clientId, managementStatus: 'NEW' }),
      this.conversations.findAll(organizationId, { clientId, managementStatus: 'PENDING' }),
      this.conversations.findAll(organizationId, { clientId, managementStatus: 'IN_PROGRESS' }),
    ]);
    return statusNew.length + statusPending.length + statusInProgress.length;
  }
}
