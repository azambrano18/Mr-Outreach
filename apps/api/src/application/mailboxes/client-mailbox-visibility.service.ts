import { Inject, Injectable } from '@nestjs/common';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionContext } from '../../domain/persistence/transaction';
import {
  CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
} from '../../infrastructure/persistence/tokens';

/**
 * §10 — "cuando un ejecutivo recibe una cuenta, debe obtener automáticamente
 * visibilidad sobre el cliente asociado, sin asignación manual previa".
 * Single, shared authority for granting/revoking that MAILBOX_DERIVED
 * visibility, called by every mailbox-assignment write path (link, reassign
 * primary, update configuration, unlink) so the rule is enforced exactly
 * once. Never touches a MANUAL grant.
 */
@Injectable()
export class ClientMailboxVisibilityService {
  constructor(
    @Inject(CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY)
    private readonly clientExecutiveAssignments: ClientExecutiveAssignmentRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly mailboxAssignments: MailboxAssignmentRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
  ) {}

  /** Grants derived visibility on `clientId` to every one of `userIds` that doesn't already have some visibility on it. */
  async grantForExecutives(
    organizationId: string,
    clientId: string,
    userIds: string[],
    actorId: string,
    ctx?: TransactionContext,
  ): Promise<void> {
    for (const userId of new Set(userIds)) {
      await this.clientExecutiveAssignments.ensureDerivedVisibility(
        { organizationId, clientId, userId, assignedBy: actorId },
        ctx,
      );
    }
  }

  /**
   * Revokes `userId`'s derived visibility on `clientId` if — and only if —
   * they no longer hold any mailbox assignment for a mailbox belonging to
   * that client (excluding a MANUAL grant, which this never touches).
   */
  async revokeIfNoRemainingMailbox(
    organizationId: string,
    clientId: string,
    userId: string,
    ctx?: TransactionContext,
  ): Promise<void> {
    const [userMailboxAssignments, clientMailboxes] = await Promise.all([
      this.mailboxAssignments.findByUser(userId, ctx),
      this.mailboxes.findAll(organizationId, ctx),
    ]);
    const clientMailboxIds = new Set(
      clientMailboxes.filter((mailbox) => mailbox.clientId === clientId).map((mailbox) => mailbox.id),
    );
    const stillHasMailbox = userMailboxAssignments.some((assignment) => clientMailboxIds.has(assignment.mailboxId));
    if (!stillHasMailbox) {
      await this.clientExecutiveAssignments.removeDerivedVisibilityIfPresent(clientId, userId, ctx);
    }
  }
}
