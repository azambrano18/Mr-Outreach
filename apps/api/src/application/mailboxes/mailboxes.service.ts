import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { EngineClient, TestMailboxResult } from '../../domain/engine/engine-client';
import { MailboxAssignment } from '../../domain/mailbox-assignment/mailbox-assignment.entity';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxConnectionTestRepository } from '../../domain/mailbox/mailbox-connection-test.repository';
import {
  Mailbox,
  MailboxAdminStatus,
  MailboxProtocolConfig,
  UpdateMailboxInput,
} from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MAILBOX_MOTOR_PORT, MailboxMotorPort } from '../../domain/mailbox-motor/mailbox-motor-port';
import { fullName, User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { ENGINE_CLIENT } from '../../infrastructure/engine/tokens';
import {
  AUDIT_LOG_REPOSITORY,
  DOMAIN_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_CONNECTION_TEST_REPOSITORY,
  MAILBOX_REPOSITORY,
  USER_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { ClientsService } from '../clients/clients.service';
import {
  AssignedMailboxSummary,
  AssigneeSummary,
  CreateMailboxPayload,
  MailboxAdminOverviewItem,
  MailboxConnectionTestSummary,
  MailboxInboxSummary,
  MailboxSummary,
  MailboxTestResultSummary,
  MailboxThreadDetail,
  MailboxThreadReadStateResult,
  ProtocolConfigInput,
  ProtocolConfigSummary,
  SetMailboxAssigneesPayload,
  UpdateMailboxPayload,
  UpdateProtocolConfigPayload,
} from './mailboxes.types';

@Injectable()
export class MailboxesService {
  constructor(
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_CONNECTION_TEST_REPOSITORY)
    private readonly connectionTests: MailboxConnectionTestRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY)
    private readonly assignments: MailboxAssignmentRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    @Inject(ENGINE_CLIENT) private readonly engineClient: EngineClient,
    @Inject(DOMAIN_REPOSITORY) private readonly domains: DomainRepository,
    @Inject(MAILBOX_MOTOR_PORT) private readonly motor: MailboxMotorPort,
    private readonly secrets: SecretEncryptionService,
    private readonly clients: ClientsService,
  ) {}

  /**
   * Fase 2.1, §7/§12 — live refresh of a SERVER_TOKEN mailbox's status.
   * Read-only from Mr Outreach's perspective except for updating its own
   * snapshot; never authorizes anything by itself (publish eligibility
   * always re-queries the motor on its own, never trusts this snapshot).
   */
  async refreshServerStatus(organizationId: string, mailboxId: string, actorId: string): Promise<MailboxSummary> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    if (mailbox.linkSource !== 'SERVER_TOKEN' || !mailbox.serverMailboxId) {
      throw new ConflictException('Esta cuenta no está vinculada por token del servidor motor.');
    }
    let status;
    try {
      status = await this.motor.getMailboxStatus(mailbox.serverMailboxId);
    } catch (error) {
      // Fail-closed — the existing snapshot (serverStatusSnapshot/serverCanSendSnapshot/serverStatusCheckedAt) is never touched on failure.
      await this.auditLogs.record({
        organizationId,
        actorId,
        action: 'mailbox.status_refresh_failed',
        entityType: 'Mailbox',
        entityId: mailbox.id,
        metadata: {
          serverMailboxId: mailbox.serverMailboxId,
          error: error instanceof Error ? error.message : 'unknown error',
        },
      });
      throw error;
    }
    const updated = await this.mailboxes.update(mailbox.id, {
      linkStatus: status.linkStatus === 'ACTIVE' ? 'ACTIVE' : 'REVOKED',
      serverStatusSnapshot: status.technicalStatus,
      serverCanSendSnapshot: status.canSend,
      serverStatusCheckedAt: status.checkedAt,
    });
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'mailbox.status_refreshed',
      entityType: 'Mailbox',
      entityId: mailbox.id,
      metadata: {
        serverMailboxId: mailbox.serverMailboxId,
        previousStatus: mailbox.serverStatusSnapshot,
        newStatus: status.technicalStatus,
        previousCanSend: mailbox.serverCanSendSnapshot,
        newCanSend: status.canSend,
        linkStatus: updated.linkStatus,
      },
    });
    return this.toSummary(updated);
  }

  /**
   * `executiveId` narrows to mailboxes assigned (any role) to that user —
   * used by the executive profile's "Cuentas asignadas" tab and by the
   * sequence sender-account picker (Fase 10), which must only ever offer
   * accounts actually assigned to the sequence's executive.
   */
  async list(organizationId: string, executiveId?: string): Promise<MailboxSummary[]> {
    if (executiveId) {
      const userAssignments = await this.assignments.findByUser(executiveId);
      const mailboxIds = new Set(userAssignments.map((assignment) => assignment.mailboxId));
      const rows = await this.mailboxes.findAll(organizationId);
      return rows.filter((row) => mailboxIds.has(row.id)).map((row) => this.toSummary(row));
    }
    const rows = await this.mailboxes.findAll(organizationId);
    return rows.map((row) => this.toSummary(row));
  }

  async getById(organizationId: string, mailboxId: string): Promise<MailboxSummary> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    return this.withResolvedNames(organizationId, mailbox, this.toSummary(mailbox));
  }

  /**
   * A SERVER_TOKEN mailbox already carries clientNameSnapshot/domainSnapshot
   * (captured at link time — never re-fetched, per §"solo lectura, viene
   * del token"). A LEGACY_LOCAL mailbox has no snapshot, so its client/
   * domain name is resolved live from the still-owned ManagedClient/Domain
   * rows — only ever for a single-record detail fetch, never the list.
   */
  private async withResolvedNames(
    organizationId: string,
    mailbox: Mailbox,
    summary: MailboxSummary,
  ): Promise<MailboxSummary> {
    let clientName = summary.clientName;
    let domainName = summary.domainName;
    if (!clientName && mailbox.clientId) {
      const client = await this.clients.getOwnedClient(organizationId, mailbox.clientId).catch(() => null);
      clientName = client?.name ?? null;
    }
    if (!domainName && mailbox.domainId) {
      const domain = await this.domains.findById(mailbox.domainId);
      domainName = domain?.domainName ?? null;
    }
    return { ...summary, clientName, domainName };
  }

  /**
   * §12.1 — denormalized rows for the admin listing/filter screen. One
   * pass over the org's mailboxes/domains/clients/assignments/users
   * instead of the frontend orchestrating N+1 fetches; filtering itself
   * happens client-side against this full list (admin-scale datasets).
   */
  async listAdminOverview(organizationId: string): Promise<MailboxAdminOverviewItem[]> {
    const [mailboxes, domains, clients, allAssignments, users] = await Promise.all([
      this.mailboxes.findAll(organizationId),
      this.domains.findAll(organizationId),
      this.clients.list(organizationId),
      this.assignments.findAllByOrganization(organizationId),
      this.users.findAll(organizationId),
    ]);

    const domainById = new Map(domains.map((d) => [d.id, d]));
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const assignmentsByMailbox = new Map<string, typeof allAssignments>();
    for (const assignment of allAssignments) {
      const list = assignmentsByMailbox.get(assignment.mailboxId) ?? [];
      list.push(assignment);
      assignmentsByMailbox.set(assignment.mailboxId, list);
    }

    return mailboxes.map((mailbox) => {
      const mailboxAssignments = assignmentsByMailbox.get(mailbox.id) ?? [];
      const primary = mailboxAssignments.find((a) => a.role === 'PRIMARY') ?? null;
      const primaryUser = primary ? userById.get(primary.userId) : undefined;
      const domain = mailbox.domainId ? domainById.get(mailbox.domainId) : undefined;
      const client = mailbox.clientId ? clientById.get(mailbox.clientId) : undefined;

      return {
        id: mailbox.id,
        clientId: mailbox.clientId,
        clientName: client?.name ?? null,
        domainId: mailbox.domainId,
        domainName: domain?.domainName ?? null,
        name: mailbox.name,
        email: mailbox.email,
        primaryExecutive: primaryUser ? { id: primaryUser.id, name: fullName(primaryUser) } : null,
        secondaryExecutiveCount: mailboxAssignments.filter((a) => a.role === 'SECONDARY').length,
        linkSource: mailbox.linkSource,
        linkStatus: mailbox.linkStatus,
        status: mailbox.status,
        serverStatusSnapshot: mailbox.serverStatusSnapshot,
        serverCanSendSnapshot: mailbox.serverCanSendSnapshot,
        serverStatusCheckedAt: mailbox.serverStatusCheckedAt,
      };
    });
  }

  async create(
    organizationId: string,
    input: CreateMailboxPayload,
    actorId: string,
  ): Promise<MailboxSummary> {
    const mailbox = await this.mailboxes.create({
      organizationId,
      name: input.name,
      email: input.email,
      fromName: input.fromName,
      replyTo: input.replyTo ?? null,
      imap: this.encryptProtocolConfig(input.imap),
      smtp: this.encryptProtocolConfig(input.smtp),
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'mailbox.create',
      entityType: 'Mailbox',
      entityId: mailbox.id,
      metadata: { email: mailbox.email },
    });

    return this.toSummary(mailbox);
  }

  async update(
    organizationId: string,
    mailboxId: string,
    input: UpdateMailboxPayload,
    actorId: string,
  ): Promise<MailboxSummary> {
    const existing = await this.getOwnedMailbox(organizationId, mailboxId);

    const patch: UpdateMailboxInput = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.email !== undefined) patch.email = input.email;
    if (input.fromName !== undefined) patch.fromName = input.fromName;
    if (input.replyTo !== undefined) patch.replyTo = input.replyTo;
    // Repositories merge partial imap/smtp patches against the stored
    // config themselves (see InMemoryMailboxRepository.update), so only
    // the fields the caller actually sent need to be included here.
    if (input.imap !== undefined) {
      patch.imap = this.toProtocolPatch(input.imap);
    }
    if (input.smtp !== undefined) {
      patch.smtp = this.toProtocolPatch(input.smtp);
    }

    const updated = await this.mailboxes.update(existing.id, patch);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'mailbox.update',
      entityType: 'Mailbox',
      entityId: mailboxId,
    });

    return this.toSummary(updated);
  }

  async setStatus(
    organizationId: string,
    mailboxId: string,
    status: MailboxAdminStatus,
    actorId: string,
  ): Promise<MailboxSummary> {
    const existing = await this.getOwnedMailbox(organizationId, mailboxId);
    const updated = await this.mailboxes.update(existing.id, { status });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: status === 'ACTIVE' ? 'mailbox.activate' : 'mailbox.deactivate',
      entityType: 'Mailbox',
      entityId: mailboxId,
    });

    return this.toSummary(updated);
  }

  /**
   * Decrypts the stored secrets only for the duration of this call (never
   * persisted, logged, or returned) and hands them to whichever
   * EngineClient is active. Updates the mailbox's live status and appends
   * one row to the connection-test history — the two together are what
   * "estado de conexión" + "historial de resultados" mean in this phase.
   */
  async testConnection(
    organizationId: string,
    mailboxId: string,
    actorId: string,
  ): Promise<MailboxTestResultSummary> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    this.requireLegacyCredentials(mailbox);

    const result = await this.engineClient.testMailbox({
      email: mailbox.email,
      imap: this.decryptProtocolConfig(mailbox.imap),
      smtp: this.decryptProtocolConfig(mailbox.smtp),
    });

    const { message, technicalMessage } = this.describeResult(result);

    await this.mailboxes.update(mailbox.id, {
      connectionStatus: result.status,
      lastTestedAt: new Date(),
      lastTestedBy: actorId,
      lastTestMessage: message,
    });

    await this.connectionTests.record({
      organizationId,
      mailboxId: mailbox.id,
      status: result.status,
      imapSuccess: result.imap.success,
      imapErrorCode: result.imap.errorCode ?? null,
      smtpSuccess: result.smtp.success,
      smtpErrorCode: result.smtp.errorCode ?? null,
      message,
      technicalMessage,
      executedBy: actorId,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'mailbox.test',
      entityType: 'Mailbox',
      entityId: mailbox.id,
      metadata: { status: result.status },
    });

    return {
      mailboxId: mailbox.id,
      status: result.status,
      imap: result.imap,
      smtp: result.smtp,
      message,
      testedAt: new Date(result.testedAt),
    };
  }

  async getConnectionTests(
    organizationId: string,
    mailboxId: string,
  ): Promise<MailboxConnectionTestSummary[]> {
    await this.getOwnedMailbox(organizationId, mailboxId);
    const entries = await this.connectionTests.findByMailbox(mailboxId);

    return entries.map((entry) => ({
      id: entry.id,
      status: entry.status,
      imapSuccess: entry.imapSuccess,
      imapErrorCode: entry.imapErrorCode,
      smtpSuccess: entry.smtpSuccess,
      smtpErrorCode: entry.smtpErrorCode,
      message: entry.message,
      technicalMessage: entry.technicalMessage,
      executedBy: entry.executedBy,
      createdAt: entry.createdAt,
    }));
  }

  /**
   * Read-through only — never persisted, never synced in the background.
   * Same "decrypt just for this call" discipline as testConnection.
   * The engine (mocked here, real once the separate engine project wires
   * up) owns the actual IMAP polling; this app never talks to a mail
   * server directly.
   */
  async getInbox(organizationId: string, mailboxId: string): Promise<MailboxInboxSummary> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    this.requireLegacyCredentials(mailbox);
    const result = await this.engineClient.fetchInbox({
      email: mailbox.email,
      imap: this.decryptProtocolConfig(mailbox.imap),
    });
    return { status: result.status, threads: result.threads };
  }

  async getThread(
    organizationId: string,
    mailboxId: string,
    threadId: string,
  ): Promise<MailboxThreadDetail> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    this.requireLegacyCredentials(mailbox);
    const result = await this.engineClient.fetchThread({
      email: mailbox.email,
      imap: this.decryptProtocolConfig(mailbox.imap),
      threadId,
    });
    return { status: result.status, messages: result.messages };
  }

  /**
   * Self-service variant for /me/mailboxes/:id/inbox — an executive only
   * holds `mailboxes.read.assigned`, not `.read.all`, so ownership is
   * enforced here (assignment check) rather than by the permission alone.
   * 404s (never 403) for a mailbox that exists but isn't assigned to this
   * user, same rule as everywhere else in this API.
   */
  async getInboxForExecutive(
    organizationId: string,
    userId: string,
    mailboxId: string,
  ): Promise<MailboxInboxSummary> {
    await this.requireAssignedMailbox(userId, mailboxId);
    return this.getInbox(organizationId, mailboxId);
  }

  async getThreadForExecutive(
    organizationId: string,
    userId: string,
    mailboxId: string,
    threadId: string,
  ): Promise<MailboxThreadDetail> {
    await this.requireAssignedMailbox(userId, mailboxId);
    return this.getThread(organizationId, mailboxId, threadId);
  }

  /**
   * Toggles a thread's unread flag. Read-through to the engine, same as
   * getInbox/getThread — nothing about a message is ever stored here.
   */
  async setThreadReadState(
    organizationId: string,
    mailboxId: string,
    threadId: string,
    isUnread: boolean,
    actorId: string,
  ): Promise<MailboxThreadReadStateResult> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    this.requireLegacyCredentials(mailbox);
    const result = await this.engineClient.setThreadReadState({
      email: mailbox.email,
      imap: this.decryptProtocolConfig(mailbox.imap),
      threadId,
      isUnread,
    });
    if (result.status === 'NOT_FOUND') {
      throw new NotFoundException('Thread not found.');
    }
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'mailbox.thread.read-state',
      entityType: 'Mailbox',
      entityId: mailboxId,
      metadata: { threadId, isUnread },
    });
    return { status: result.status };
  }

  async setThreadReadStateForExecutive(
    organizationId: string,
    userId: string,
    mailboxId: string,
    threadId: string,
    isUnread: boolean,
  ): Promise<MailboxThreadReadStateResult> {
    await this.requireAssignedMailbox(userId, mailboxId);
    return this.setThreadReadState(organizationId, mailboxId, threadId, isUnread, userId);
  }

  private async requireAssignedMailbox(userId: string, mailboxId: string): Promise<void> {
    const userAssignments = await this.assignments.findByUser(userId);
    if (!userAssignments.some((assignment) => assignment.mailboxId === mailboxId)) {
      throw new NotFoundException('Mailbox not found.');
    }
  }

  async getAssignees(organizationId: string, mailboxId: string): Promise<AssigneeSummary[]> {
    await this.getOwnedMailbox(organizationId, mailboxId);
    const assignments = await this.assignments.findByMailbox(mailboxId);
    return this.toAssigneeSummaries(organizationId, assignments);
  }

  /**
   * Links a mailbox into the Cliente → Dominio hierarchy — the only way
   * `clientId`/`domainId` are ever set (never via the generic `update()`
   * DTO). `clientId` is always deduced from the domain's own client, never
   * accepted independently, so a mailbox can never end up pointing at a
   * domain and a client that disagree with each other.
   */
  async linkToDomain(
    organizationId: string,
    mailboxId: string,
    domainId: string,
    actorId: string,
  ): Promise<MailboxSummary> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    const domain = await this.domains.findById(domainId);
    if (!domain || domain.organizationId !== organizationId) {
      throw new NotFoundException('Domain not found.');
    }

    // §9 — the first point where mailbox↔client becomes unambiguous; never
    // gated in create() (per §9, no client relationship exists yet there).
    await this.clients.assertClientCrmEligible(organizationId, domain.clientId, actorId);

    const updated = await this.mailboxes.update(mailbox.id, {
      domainId: domain.id,
      clientId: domain.clientId,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'mailbox.link_domain',
      entityType: 'Mailbox',
      entityId: mailbox.id,
      metadata: { domainId: domain.id, clientId: domain.clientId },
    });

    return this.toSummary(updated);
  }

  /** Every mailbox in a client's domains — "Cuentas totales" on the client view. */
  async listByClient(organizationId: string, clientId: string): Promise<MailboxSummary[]> {
    const rows = await this.mailboxes.findAll(organizationId);
    return rows.filter((row) => row.clientId === clientId).map((row) => this.toSummary(row));
  }

  /** Every mailbox linked to one domain — the domain view's account list. */
  async listByDomain(organizationId: string, domainId: string): Promise<MailboxSummary[]> {
    const rows = await this.mailboxes.findAll(organizationId);
    return rows.filter((row) => row.domainId === domainId).map((row) => this.toSummary(row));
  }

  /** Mailboxes with no client/domain yet — "Pendiente de clasificación". */
  async listUnclassified(organizationId: string): Promise<MailboxSummary[]> {
    const rows = await this.mailboxes.findAll(organizationId);
    return rows.filter((row) => !row.clientId).map((row) => this.toSummary(row));
  }

  /** Self-service: only mailboxes both in this client and individually assigned to the executive. */
  async listByClientForExecutive(
    organizationId: string,
    userId: string,
    clientId: string,
  ): Promise<MailboxSummary[]> {
    const assignedIds = await this.assignedMailboxIdSet(userId);
    const rows = await this.mailboxes.findAll(organizationId);
    return rows
      .filter((row) => row.clientId === clientId && assignedIds.has(row.id))
      .map((row) => this.toSummary(row));
  }

  async listByDomainForExecutive(
    organizationId: string,
    userId: string,
    domainId: string,
  ): Promise<MailboxSummary[]> {
    const assignedIds = await this.assignedMailboxIdSet(userId);
    const rows = await this.mailboxes.findAll(organizationId);
    return rows
      .filter((row) => row.domainId === domainId && assignedIds.has(row.id))
      .map((row) => this.toSummary(row));
  }

  private async assignedMailboxIdSet(userId: string): Promise<Set<string>> {
    const userAssignments = await this.assignments.findByUser(userId);
    return new Set(userAssignments.map((assignment) => assignment.mailboxId));
  }

  /**
   * Replaces the full set of executives assigned to a mailbox in one call
   * — the admin UI always submits the complete desired state (one primary
   * picker + a secondary checkbox list), so diffing against the current
   * set here keeps the repository port itself minimal. "Only one PRIMARY
   * per mailbox" is enforced here, not in the database — see
   * MailboxAssignmentRepository's class comment for why.
   */
  async setAssignees(
    organizationId: string,
    mailboxId: string,
    input: SetMailboxAssigneesPayload,
    actorId: string,
  ): Promise<AssigneeSummary[]> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    const secondaryUserIds = [...new Set(input.secondaryUserIds)].filter(
      (id) => id !== input.primaryUserId,
    );
    const desiredIds = input.primaryUserId
      ? [input.primaryUserId, ...secondaryUserIds]
      : secondaryUserIds;

    // Validates every id belongs to this organization and is active
    // before changing anything — a bad id must fail the whole call, not
    // partially apply (section 15: "evitar seleccionar ejecutivos
    // inactivos" is enforced here, not just hidden in the UI).
    await Promise.all(
      desiredIds.map((userId) => this.requireAssignableUser(organizationId, userId)),
    );

    const current = await this.assignments.findByMailbox(mailbox.id);
    const desired = new Set(desiredIds);
    const toRemove = current.filter((assignment) => !desired.has(assignment.userId));

    await Promise.all(
      toRemove.map((assignment) => this.assignments.remove(mailbox.id, assignment.userId)),
    );
    if (input.primaryUserId) {
      await this.assignments.upsert({
        organizationId,
        mailboxId: mailbox.id,
        userId: input.primaryUserId,
        role: 'PRIMARY',
        assignedBy: actorId,
      });
    }
    await Promise.all(
      secondaryUserIds.map((userId) =>
        this.assignments.upsert({
          organizationId,
          mailboxId: mailbox.id,
          userId,
          role: 'SECONDARY',
          assignedBy: actorId,
        }),
      ),
    );

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'mailbox.assign',
      entityType: 'Mailbox',
      entityId: mailbox.id,
      metadata: { primaryUserId: input.primaryUserId, secondaryUserIds },
    });

    return this.toAssigneeSummaries(
      organizationId,
      await this.assignments.findByMailbox(mailbox.id),
    );
  }

  /** Backs GET /me/mailboxes — the assigned-only view executives use. */
  async getAssignedMailboxesForUser(
    organizationId: string,
    userId: string,
  ): Promise<AssignedMailboxSummary[]> {
    const userAssignments = await this.assignments.findByUser(userId);
    const mailboxes = await Promise.all(
      userAssignments.map((assignment) => this.mailboxes.findById(assignment.mailboxId)),
    );

    const owned = mailboxes.filter(
      (mailbox): mailbox is Mailbox => !!mailbox && mailbox.organizationId === organizationId,
    );

    // Etapa "cuenta del ejecutivo" §6 — Plantillas needs the client/domain
    // name to auto-derive its own name and to show a read-only preview once
    // the executive picks a mailbox; reuses the same resolution getById()
    // already does (snapshot for SERVER_TOKEN, live lookup for legacy).
    const withNames = await Promise.all(
      owned.map(async (mailbox) => {
        const resolved = await this.getById(organizationId, mailbox.id).catch(() => null);
        return { mailbox, clientName: resolved?.clientName ?? null, domainName: resolved?.domainName ?? null };
      }),
    );

    return withNames.map(({ mailbox, clientName, domainName }) => ({
      id: mailbox.id,
      name: mailbox.name,
      email: mailbox.email,
      fromName: mailbox.fromName,
      replyTo: mailbox.replyTo,
      status: mailbox.status,
      connectionStatus: mailbox.connectionStatus,
      lastTestedAt: mailbox.lastTestedAt ? mailbox.lastTestedAt.toISOString() : null,
      lastTestMessage: mailbox.lastTestMessage,
      clientName,
      domainName,
    }));
  }

  /** Backs GET /me/mailboxes/:id/assignees — read-only, no add/remove (that stays admin-only via mailboxes.assign). */
  async getAssigneesForExecutive(
    organizationId: string,
    userId: string,
    mailboxId: string,
  ): Promise<AssigneeSummary[]> {
    await this.requireAssignedMailbox(userId, mailboxId);
    return this.getAssignees(organizationId, mailboxId);
  }

  private async toAssigneeSummaries(
    organizationId: string,
    assignments: MailboxAssignment[],
  ): Promise<AssigneeSummary[]> {
    const users = await Promise.all(
      assignments.map(async (assignment) => ({
        assignment,
        user: await this.users.findById(assignment.userId),
      })),
    );
    return users
      .filter(
        (row): row is { assignment: MailboxAssignment; user: User } =>
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

  /** Must be a real, org-owned, ACTIVE executive — section 15: "evitar seleccionar ejecutivos inactivos". */
  private async requireAssignableUser(organizationId: string, userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user || user.organizationId !== organizationId) {
      throw new BadRequestException('Invalid executive id.');
    }
    if (user.status !== 'ACTIVE') {
      throw new BadRequestException('Cannot assign an inactive executive.');
    }
    return user;
  }

  /** Same 404-not-403 rule as UsersService — see its comment for why. */
  private async getOwnedMailbox(organizationId: string, mailboxId: string): Promise<Mailbox> {
    const mailbox = await this.mailboxes.findById(mailboxId);
    if (!mailbox || mailbox.organizationId !== organizationId) {
      throw new NotFoundException('Mailbox not found.');
    }
    return mailbox;
  }

  private encryptProtocolConfig(input: ProtocolConfigInput): MailboxProtocolConfig {
    return {
      host: input.host,
      port: input.port,
      encryption: input.encryption,
      username: input.username,
      verifyCertificate: input.verifyCertificate,
      secretCiphertext: this.secrets.encrypt(input.password),
    };
  }

  /** Fase 2.1 — testConnection/getInbox/getThread/setThreadReadState are all real IMAP/SMTP operations, meaningless for a SERVER_TOKEN mailbox (Mr Outreach never holds its credentials). */
  private requireLegacyCredentials(
    mailbox: Mailbox,
  ): asserts mailbox is Mailbox & { imap: MailboxProtocolConfig; smtp: MailboxProtocolConfig } {
    if (!mailbox.imap || !mailbox.smtp) {
      throw new ConflictException(
        'Esta cuenta está vinculada por token del servidor motor; esta operación solo está disponible para cuentas con configuración IMAP/SMTP local.',
      );
    }
  }

  private decryptProtocolConfig(config: MailboxProtocolConfig) {
    return {
      host: config.host,
      port: config.port,
      encryption: config.encryption,
      username: config.username,
      verifyCertificate: config.verifyCertificate,
      password: this.secrets.decrypt(config.secretCiphertext),
    };
  }

  private toProtocolPatch(patch: UpdateProtocolConfigPayload): Partial<MailboxProtocolConfig> {
    const result: Partial<MailboxProtocolConfig> = {};
    if (patch.host !== undefined) result.host = patch.host;
    if (patch.port !== undefined) result.port = patch.port;
    if (patch.encryption !== undefined) result.encryption = patch.encryption;
    if (patch.username !== undefined) result.username = patch.username;
    if (patch.verifyCertificate !== undefined) result.verifyCertificate = patch.verifyCertificate;
    // Only re-encrypt when the caller actually supplied a new password —
    // an edit form that leaves the password blank must not wipe it.
    if (patch.password !== undefined) {
      result.secretCiphertext = this.secrets.encrypt(patch.password);
    }
    return result;
  }

  /** Spanish, human-readable message + a compact technical string — never a secret. */
  private describeResult(result: TestMailboxResult): { message: string; technicalMessage: string } {
    const imapNote = result.imap.success ? 'ok' : (result.imap.errorCode ?? 'error');
    const smtpNote = result.smtp.success ? 'ok' : (result.smtp.errorCode ?? 'error');
    const technicalMessage = `imap=${imapNote} smtp=${smtpNote}`;

    switch (result.status) {
      case 'CONNECTED':
        return { message: 'Conexión exitosa a IMAP y SMTP.', technicalMessage };
      case 'PARTIALLY_CONNECTED': {
        const imapPart = result.imap.success
          ? 'IMAP conectado'
          : `IMAP falló (${result.imap.errorCode ?? 'error desconocido'})`;
        const smtpPart = result.smtp.success
          ? 'SMTP conectado'
          : `SMTP falló (${result.smtp.errorCode ?? 'error desconocido'})`;
        return { message: `Conexión parcial: ${imapPart}; ${smtpPart}.`, technicalMessage };
      }
      case 'CONNECTION_ERROR':
        return {
          message: 'No se pudo establecer conexión con el servidor de correo.',
          technicalMessage,
        };
      case 'ENGINE_UNAVAILABLE':
        return {
          message: 'El motor de ejecución no está disponible en este momento.',
          technicalMessage: 'engine_unavailable',
        };
      default:
        return { message: 'Resultado de prueba desconocido.', technicalMessage };
    }
  }

  private toSummary(mailbox: Mailbox): MailboxSummary {
    return {
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      clientId: mailbox.clientId,
      domainId: mailbox.domainId,
      clientName: mailbox.clientNameSnapshot,
      domainName: mailbox.domainSnapshot,
      name: mailbox.name,
      email: mailbox.email,
      fromName: mailbox.fromName,
      replyTo: mailbox.replyTo,
      status: mailbox.status,
      connectionStatus: mailbox.connectionStatus,
      provisioningStatus: mailbox.provisioningStatus,
      operationalStatus: this.computeOperationalStatus(mailbox),
      timezone: mailbox.timezone,
      sendingLimits: mailbox.sendingLimits,
      lastProvisionCommandId: mailbox.lastProvisionCommandId,
      lastTestedAt: mailbox.lastTestedAt,
      lastTestMessage: mailbox.lastTestMessage,
      imap: this.toProtocolSummary(mailbox.imap),
      smtp: this.toProtocolSummary(mailbox.smtp),
      linkSource: mailbox.linkSource,
      linkStatus: mailbox.linkStatus,
      serverMailboxId: mailbox.serverMailboxId,
      serverStatusSnapshot: mailbox.serverStatusSnapshot,
      serverCanSendSnapshot: mailbox.serverCanSendSnapshot,
      serverStatusCheckedAt: mailbox.serverStatusCheckedAt,
      linkedAt: mailbox.linkedAt,
      linkedBy: mailbox.linkedBy,
      createdAt: mailbox.createdAt,
      updatedAt: mailbox.updatedAt,
    };
  }

  /**
   * §12's "Estado operativo" — deliberately computed, not persisted (see
   * the Mailbox entity's doc comment). PAUSED has no dedicated trigger in
   * this phase (there's no "pause a ready mailbox" action yet), so it's
   * modeled in the type for spec completeness but never actually returned.
   */
  private computeOperationalStatus(mailbox: Mailbox): MailboxSummary['operationalStatus'] {
    if (mailbox.status === 'ARCHIVED') return 'ARCHIVED';
    if (mailbox.status === 'INACTIVE') return 'SUSPENDED';
    if (
      mailbox.provisioningStatus === 'PROVISION_FAILED' ||
      mailbox.connectionStatus === 'CONNECTION_ERROR' ||
      mailbox.connectionStatus === 'ENGINE_UNAVAILABLE'
    ) {
      return 'ERROR';
    }
    if (mailbox.provisioningStatus === 'PROVISIONED' && mailbox.connectionStatus === 'CONNECTED') {
      return 'READY';
    }
    return 'DRAFT';
  }

  private toProtocolSummary(config: MailboxProtocolConfig | null): ProtocolConfigSummary | null {
    if (!config) return null;
    return {
      host: config.host,
      port: config.port,
      encryption: config.encryption,
      username: config.username,
      verifyCertificate: config.verifyCertificate,
      credentialsConfigured: true,
    };
  }
}
