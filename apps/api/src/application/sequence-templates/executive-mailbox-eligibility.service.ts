import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MAILBOX_MOTOR_PORT, MailboxMotorPort } from '../../domain/mailbox-motor/mailbox-motor-port';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import {
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
} from '../../infrastructure/persistence/tokens';

/**
 * §3 — the single fail-closed gate both "Publicar plantilla" and "Iniciar
 * gestión" must pass through before touching the motor: organization
 * ownership, an active PRIMARY/SECONDARY assignment for this specific
 * executive, local ACTIVE status, not revoked, and — for a SERVER_TOKEN
 * mailbox — a live, synchronous check against MailboxMotorPort. If the
 * motor can't be reached, `getMailboxStatus` throws
 * `ServiceUnavailableException`, which propagates unchanged: no publish,
 * no execution start, ever proceeds on a cached/stale snapshot.
 */
@Injectable()
export class ExecutiveMailboxEligibilityService {
  constructor(
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly assignments: MailboxAssignmentRepository,
    @Inject(MAILBOX_MOTOR_PORT) private readonly motor: MailboxMotorPort,
  ) {}

  async requireEligible(organizationId: string, executiveId: string, mailboxId: string): Promise<Mailbox> {
    const mailbox = await this.mailboxes.findById(mailboxId);
    if (!mailbox || mailbox.organizationId !== organizationId) {
      throw new NotFoundException('Cuenta de correo no encontrada.');
    }

    const mailboxAssignments = await this.assignments.findByMailbox(mailboxId);
    const isAssigned = mailboxAssignments.some((assignment) => assignment.userId === executiveId);
    if (!isAssigned) {
      throw new ForbiddenException('No tienes una asignación activa sobre esta cuenta de correo.');
    }

    if (mailbox.status !== 'ACTIVE') {
      throw new ConflictException('Esta cuenta está desactivada en Mr Outreach.');
    }
    if (mailbox.linkStatus === 'REVOKED') {
      throw new ConflictException('Esta cuenta fue desvinculada; no puede usarse.');
    }

    if (mailbox.linkSource === 'SERVER_TOKEN') {
      if (!mailbox.serverMailboxId) {
        throw new ConflictException('Esta cuenta vinculada por token no tiene un identificador de servidor válido.');
      }
      // Fail-closed: a thrown ServiceUnavailableException here propagates to the caller unchanged.
      const status = await this.motor.getMailboxStatus(mailbox.serverMailboxId);
      await this.mailboxes.update(mailbox.id, {
        linkStatus: status.linkStatus === 'ACTIVE' ? 'ACTIVE' : 'REVOKED',
        serverStatusSnapshot: status.technicalStatus,
        serverCanSendSnapshot: status.canSend,
        serverStatusCheckedAt: status.checkedAt,
      });
      if (status.linkStatus !== 'ACTIVE') {
        throw new ConflictException('Esta cuenta fue revocada o desvinculada; no puede usarse.');
      }
      if (!status.canSend || status.technicalStatus !== 'CONNECTED') {
        throw new ConflictException('Esta cuenta no está en condiciones técnicas de enviar correos en este momento.');
      }
    }

    return this.mailboxes.findById(mailboxId) as Promise<Mailbox>;
  }
}
