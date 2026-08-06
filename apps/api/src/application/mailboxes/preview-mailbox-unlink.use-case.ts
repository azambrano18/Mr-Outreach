import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CANCELLABLE_SCHEDULED_EMAIL_STATUSES } from '../../domain/scheduled-email/scheduled-email.entity';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MailboxLinkStatus } from '../../domain/mailbox/mailbox.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { fullName } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import {
  CONVERSATION_REPOSITORY,
  DOMAIN_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  MANAGED_CLIENT_REPOSITORY,
  SCHEDULED_EMAIL_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
  SEQUENCE_TEMPLATE_REPOSITORY,
  USER_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { ACTIVE_EXECUTION_STATUSES_BLOCKING_UNLINK } from './unlink-mailbox.use-case';

export interface MailboxUnlinkExecutiveSummary {
  id: string;
  name: string;
  email: string;
}

export interface MailboxUnlinkPreview {
  mailboxId: string;
  email: string;
  clientName: string | null;
  domainName: string | null;
  linkStatus: MailboxLinkStatus;
  canUnlink: boolean;
  blockingReasons: string[];
  primaryExecutive: MailboxUnlinkExecutiveSummary | null;
  secondaryExecutives: MailboxUnlinkExecutiveSummary[];
  conversationCount: number;
  templateCount: number;
  activeManagements: number;
  pendingJobs: number;
  assignmentsToRemove: number;
}

/**
 * §1/§11 — a pure, read-only preflight for "Desvincular cuenta": re-derives
 * every check `UnlinkMailboxUseCase` itself enforces (never assumed
 * authoritative on its own — the backend re-validates all of this again at
 * confirmation time), so the modal can show the admin exactly who is
 * assigned and why the action would or wouldn't be allowed, before they
 * commit to it. Never writes anything.
 */
@Injectable()
export class PreviewMailboxUnlinkUseCase {
  constructor(
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly assignments: MailboxAssignmentRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MANAGED_CLIENT_REPOSITORY) private readonly managedClients: ManagedClientRepository,
    @Inject(DOMAIN_REPOSITORY) private readonly domains: DomainRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(SEQUENCE_TEMPLATE_REPOSITORY) private readonly sequenceTemplates: SequenceTemplateRepository,
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly sequenceExecutions: SequenceExecutionRepository,
    @Inject(SCHEDULED_EMAIL_REPOSITORY) private readonly scheduledEmails: ScheduledEmailRepository,
  ) {}

  async execute(organizationId: string, mailboxId: string): Promise<MailboxUnlinkPreview> {
    const mailbox = await this.mailboxes.findById(mailboxId);
    if (!mailbox || mailbox.organizationId !== organizationId) {
      throw new NotFoundException('Cuenta de correo no encontrada.');
    }

    const [assignmentRows, client, domain, conversations, templates, allExecutions, scheduledEmailRows] =
      await Promise.all([
        this.assignments.findByMailbox(mailbox.id),
        mailbox.clientId ? this.managedClients.findById(mailbox.clientId) : Promise.resolve(null),
        mailbox.domainId ? this.domains.findById(mailbox.domainId) : Promise.resolve(null),
        this.conversations.findAll(organizationId, { mailboxId: mailbox.id }),
        this.sequenceTemplates.findByMailbox(organizationId, mailbox.id),
        this.sequenceExecutions.findAllByOrganization(organizationId),
        this.scheduledEmails.findAll(organizationId, { mailboxId: mailbox.id }),
      ]);

    const usersById = new Map(
      (await Promise.all(assignmentRows.map((a) => this.users.findById(a.userId)))).map((user, index) => [
        assignmentRows[index]!.userId,
        user,
      ]),
    );
    const toSummary = (userId: string): MailboxUnlinkExecutiveSummary | null => {
      const user = usersById.get(userId);
      return user ? { id: user.id, name: fullName(user), email: user.email } : null;
    };

    const primaryExecutive = assignmentRows
      .filter((a) => a.role === 'PRIMARY')
      .map((a) => toSummary(a.userId))
      .find((summary): summary is MailboxUnlinkExecutiveSummary => summary !== null) ?? null;
    const secondaryExecutives = assignmentRows
      .filter((a) => a.role === 'SECONDARY')
      .map((a) => toSummary(a.userId))
      .filter((summary): summary is MailboxUnlinkExecutiveSummary => summary !== null);

    const activeExecutions = allExecutions.filter(
      (execution) =>
        execution.mailboxId === mailbox.id && ACTIVE_EXECUTION_STATUSES_BLOCKING_UNLINK.includes(execution.status),
    );
    const pendingJobs = scheduledEmailRows.filter((row) => CANCELLABLE_SCHEDULED_EMAIL_STATUSES.includes(row.status));

    const blockingReasons: string[] = [];
    if (mailbox.linkSource !== 'SERVER_TOKEN') {
      blockingReasons.push('Esta cuenta no está vinculada por token; no admite desvinculación.');
    }
    if (mailbox.linkStatus === 'REVOKED') {
      blockingReasons.push('La cuenta ya está desvinculada.');
    }
    if (mailbox.linkStatus === 'UNLINK_REQUESTED') {
      blockingReasons.push('Ya existe una desvinculación en proceso para esta cuenta.');
    }
    if (activeExecutions.length > 0) {
      blockingReasons.push(
        'No puedes desvincular esta cuenta porque tiene Gestiones activas. Pausa o detén las Gestiones antes de continuar.',
      );
    }

    return {
      mailboxId: mailbox.id,
      email: mailbox.email,
      clientName: client?.name ?? null,
      domainName: domain?.domainName ?? null,
      linkStatus: mailbox.linkStatus,
      canUnlink: blockingReasons.length === 0,
      blockingReasons,
      primaryExecutive,
      secondaryExecutives,
      conversationCount: conversations.length,
      templateCount: templates.length,
      activeManagements: activeExecutions.length,
      pendingJobs: pendingJobs.length,
      assignmentsToRemove: assignmentRows.length,
    };
  }
}
