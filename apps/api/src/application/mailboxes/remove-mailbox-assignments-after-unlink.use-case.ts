import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { fullName } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import {
  AUDIT_LOG_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  TRANSACTION_MANAGER,
  USER_REPOSITORY,
} from '../../infrastructure/persistence/tokens';

export interface RemoveMailboxAssignmentsAfterUnlinkInput {
  organizationId: string;
  mailboxId: string;
  actorId: string;
  /** Carried over from the unlink flow so both events can be traced back to the same operation — see UnlinkMailboxUseCase. */
  correlationId?: string;
  unlinkRevocationId?: string | null;
}

export interface RemovedExecutiveSummary {
  id: string;
  name: string;
  email: string;
}

export interface RemoveMailboxAssignmentsAfterUnlinkResult {
  mailboxId: string;
  assignmentsRemoved: number;
  primaryRemoved: RemovedExecutiveSummary | null;
  secondaryRemoved: RemovedExecutiveSummary[];
}

/**
 * §6/§8/§9 of the "mejora del flujo de desvinculación" — the SINGLE place
 * that ever removes a MailboxAssignment row as a *consequence* of an
 * unlink, reused by three callers: UnlinkMailboxUseCase.confirmWithMotor
 * (right after the motor confirms REVOKED, when the admin authorized it),
 * UnlinkMailboxUseCase.execute's already-REVOKED idempotent branch (so a
 * repeat unlink request against an already-revoked mailbox can still
 * complete a previously-unauthorized removal), and the explicit admin
 * "Limpiar asignaciones residuales" endpoint. Never creates a parallel
 * removal path.
 *
 * Never touches the User row itself (no delete/deactivate/role change) —
 * only the MailboxAssignment join for THIS mailbox. Idempotent: if there
 * are no assignments left, it's a silent no-op success with no audit
 * entry (nothing changed, nothing to audit — avoids spamming the trail on
 * every idempotent unlink replay); an audit entry is written exactly once,
 * only when rows are actually removed.
 */
@Injectable()
export class RemoveMailboxAssignmentsAfterUnlinkUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly assignments: MailboxAssignmentRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
  ) {}

  async execute(input: RemoveMailboxAssignmentsAfterUnlinkInput): Promise<RemoveMailboxAssignmentsAfterUnlinkResult> {
    return this.tx.run(async (ctx) => {
      const mailbox = await this.mailboxes.findById(input.mailboxId, ctx);
      if (!mailbox || mailbox.organizationId !== input.organizationId) {
        throw new NotFoundException('Cuenta de correo no encontrada.');
      }
      if (mailbox.linkStatus !== 'REVOKED') {
        throw new ConflictException(
          'Solo se pueden retirar las asignaciones de una cuenta cuya desvinculación ya fue confirmada.',
        );
      }

      const currentAssignments = await this.assignments.findByMailbox(mailbox.id, ctx);
      if (currentAssignments.length === 0) {
        return { mailboxId: mailbox.id, assignmentsRemoved: 0, primaryRemoved: null, secondaryRemoved: [] };
      }

      const withUsers = await Promise.all(
        currentAssignments.map(async (assignment) => ({ assignment, user: await this.users.findById(assignment.userId) })),
      );
      const toSummary = (user: (typeof withUsers)[number]['user']): RemovedExecutiveSummary | null =>
        user ? { id: user.id, name: fullName(user), email: user.email } : null;

      const primaryRemoved = toSummary(withUsers.find((row) => row.assignment.role === 'PRIMARY')?.user ?? null);
      const secondaryRemoved = withUsers
        .filter((row) => row.assignment.role === 'SECONDARY')
        .map((row) => toSummary(row.user))
        .filter((summary): summary is RemovedExecutiveSummary => summary !== null);

      for (const assignment of currentAssignments) {
        await this.assignments.remove(mailbox.id, assignment.userId, ctx);
      }

      await this.auditLogs.record(
        {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: 'mailbox.assignments_removed_after_unlink',
          entityType: 'Mailbox',
          entityId: mailbox.id,
          metadata: {
            email: mailbox.email,
            actorUserId: input.actorId,
            primaryRemoved,
            secondaryRemoved,
            assignmentsRemoved: currentAssignments.length,
            previousState: 'ASSIGNED',
            newState: 'UNASSIGNED',
            correlationId: input.correlationId ?? `corr_${mailbox.id}`,
            unlinkRevocationId: input.unlinkRevocationId ?? mailbox.revocationId,
            result: 'SUCCESS',
          },
        },
        ctx,
      );

      return {
        mailboxId: mailbox.id,
        assignmentsRemoved: currentAssignments.length,
        primaryRemoved,
        secondaryRemoved,
      };
    });
  }
}
