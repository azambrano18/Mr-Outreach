import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceExecutionStatus } from '../../domain/sequence-execution/sequence-execution.entity';
import {
  AUDIT_LOG_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';

export interface DeleteMailboxInput {
  organizationId: string;
  mailboxId: string;
  actorId: string;
}

const NON_TERMINAL_EXECUTION_STATUSES: SequenceExecutionStatus[] = [
  'DRAFT',
  'VALIDATING',
  'SUBMITTING',
  'SUBMISSION_UNKNOWN',
  'ACCEPTED',
  'RUNNING',
];

/**
 * §8.2 — removes a mailbox from Mr Outreach entirely, but only once it has
 * already been unlinked (linkStatus REVOKED) — LINKED → UNLINKED → DELETED,
 * never LINKED → DELETED directly. Soft-delete only (`deletedAt`), same
 * convention as User/Conversation: every read path already filters
 * `deletedAt: null`, so once this commits the mailbox instantly disappears
 * from every listing, selector, and direct lookup by id — never a hard
 * DELETE, never touches historical audit rows.
 *
 * Blocks (ConflictException) if the mailbox still owns a non-terminal
 * Gestión — those must finish, fail, or move to another mailbox first.
 * Any remaining MailboxAssignment rows are removed as part of the delete
 * (a revoked mailbox shouldn't still show assignees), inside the same
 * transaction as the soft-delete and the audit entry.
 */
@Injectable()
export class DeleteMailboxUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly assignments: MailboxAssignmentRepository,
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly sequenceExecutions: SequenceExecutionRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
  ) {}

  async execute(input: DeleteMailboxInput): Promise<void> {
    await this.tx.run(async (ctx) => {
      const mailbox = await this.mailboxes.findById(input.mailboxId, ctx);
      if (!mailbox || mailbox.organizationId !== input.organizationId) {
        throw new NotFoundException('Cuenta de correo no encontrada.');
      }
      if (mailbox.linkStatus !== 'REVOKED') {
        throw new ConflictException(
          'Solo se pueden eliminar cuentas que ya fueron desvinculadas. Desvincula la cuenta primero.',
        );
      }

      const allExecutions = await this.sequenceExecutions.findAllByOrganization(input.organizationId);
      const activeExecutions = allExecutions.filter(
        (execution) =>
          execution.mailboxId === mailbox.id && NON_TERMINAL_EXECUTION_STATUSES.includes(execution.status),
      );
      if (activeExecutions.length > 0) {
        throw new ConflictException(
          `Esta cuenta tiene ${activeExecutions.length} gestión(es) sin finalizar. Deben completarse, fallar o reasignarse antes de eliminarla.`,
        );
      }

      const mailboxAssignments = await this.assignments.findByMailbox(mailbox.id, ctx);
      for (const assignment of mailboxAssignments) {
        await this.assignments.remove(mailbox.id, assignment.userId, ctx);
      }

      await this.mailboxes.update(mailbox.id, { deletedAt: new Date() }, ctx);

      await this.auditLogs.record(
        {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: 'mailbox.delete',
          entityType: 'Mailbox',
          entityId: mailbox.id,
          metadata: { email: mailbox.email, assignmentsRemoved: mailboxAssignments.length },
        },
        ctx,
      );
    });
  }
}
