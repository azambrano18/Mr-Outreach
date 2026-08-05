import { Inject, Injectable } from '@nestjs/common';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { SimulationConversationBatchRepository } from '../../domain/simulation-conversation/simulation-conversation-batch.repository';
import { fullName } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import {
  CONVERSATION_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  SIMULATION_CONVERSATION_BATCH_REPOSITORY,
  USER_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { EligibleMailboxSummary, SimulationBatchSummary } from './simulation-conversations.types';
import { SCENARIOS } from './simulation-scenarios';

/** Read-only queries backing "Conversaciones de prueba" — the two mutations (generate/delete) live in their own use-case classes. */
@Injectable()
export class SimulationConversationsService {
  constructor(
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly mailboxAssignments: MailboxAssignmentRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(SIMULATION_CONVERSATION_BATCH_REPOSITORY) private readonly batches: SimulationConversationBatchRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly mailboxesService: MailboxesService,
  ) {}

  /**
   * §7 — only mailboxes the requesting admin is themselves assigned to
   * (PRIMARY or SECONDARY), not deleted, linked, and ACTIVE: this
   * guarantees the 4 generated conversations are immediately reachable
   * from that admin's own "Cuentas de correos" tree afterward — the same
   * MailboxAssignment-based visibility every other conversation in this
   * app already depends on (see ConversationsService.listForExecutive).
   */
  async listEligibleMailboxes(organizationId: string, actorId: string): Promise<EligibleMailboxSummary[]> {
    const assignments = await this.mailboxAssignments.findByUser(actorId);
    const results: EligibleMailboxSummary[] = [];
    for (const assignment of assignments) {
      const mailbox = await this.mailboxes.findById(assignment.mailboxId);
      if (!mailbox || mailbox.organizationId !== organizationId) continue;
      if (mailbox.status !== 'ACTIVE' || mailbox.linkStatus === 'REVOKED') continue;

      const resolved = await this.mailboxesService.getById(organizationId, mailbox.id).catch(() => null);
      const allAssignments = await this.mailboxAssignments.findByMailbox(mailbox.id);
      const primary = allAssignments.find((a) => a.role === 'PRIMARY');
      const primaryUser = primary ? await this.users.findById(primary.userId) : null;

      results.push({
        id: mailbox.id,
        email: mailbox.email,
        clientName: resolved?.clientName ?? null,
        domainName: resolved?.domainName ?? null,
        primaryExecutiveName: primaryUser ? fullName(primaryUser) : null,
        status: mailbox.status,
        linkStatus: mailbox.linkStatus,
      });
    }
    return results;
  }

  /** Null when no batch exists — the frontend shows "Generar" instead of "Eliminar". */
  async getActiveBatch(organizationId: string): Promise<SimulationBatchSummary | null> {
    const batch = await this.batches.findActiveByOrganization(organizationId);
    if (!batch) return null;
    return this.toBatchSummary(batch);
  }

  async toBatchSummary(batch: {
    id: string;
    organizationId: string;
    mailboxId: string;
    createdByUserId: string;
    createdAt: Date;
  }): Promise<SimulationBatchSummary> {
    const [mailbox, createdByUser, rows] = await Promise.all([
      this.mailboxes.findById(batch.mailboxId),
      this.users.findById(batch.createdByUserId),
      this.conversations.findAll(batch.organizationId, { simulationBatchId: batch.id }),
    ]);
    return {
      id: batch.id,
      organizationId: batch.organizationId,
      mailboxId: batch.mailboxId,
      mailboxEmail: mailbox?.email ?? '',
      createdByUserId: batch.createdByUserId,
      createdByUserName: createdByUser ? fullName(createdByUser) : 'Usuario eliminado',
      createdAt: batch.createdAt,
      conversations: rows.map((row) => {
        const config = SCENARIOS.find((s) => s.scenario === row.simulationScenario);
        return {
          id: row.id,
          scenario: row.simulationScenario ?? 'NOT_INTERESTED',
          label: config?.label ?? row.subject,
          contactEmail: row.contactEmail,
          contactName: row.contactName ?? row.contactEmail,
        };
      }),
    };
  }
}
