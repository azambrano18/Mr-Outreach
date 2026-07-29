import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IntegrationCommand } from '../../domain/integration/integration-command.entity';
import { IntegrationEvent } from '../../domain/integration/integration-event.entity';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MAILBOX_REPOSITORY } from '../../infrastructure/persistence/tokens';
import {
  MailboxProvisionScenario,
  SimulatedMailEngineAdapter,
} from '../../infrastructure/mail-engine/simulated/simulated-mail-engine-adapter';
import { IntegrationService } from '../integration/integration.service';
import { MailboxProvisioningEventApplier } from './mailbox-provisioning-event-applier';

/**
 * §8-12 — turns "Guardar cuenta" into a MAILBOX_PROVISION_REQUESTED command
 * instead of a synchronous IMAP/SMTP connect. Deliberately separate from
 * MailboxesService.testConnection (which stays exactly as it was — a
 * synchronous EngineClient call unrelated to this async flow); this service
 * owns only the new provisioning lifecycle riding on IntegrationService.
 *
 * Fase 2 — kept as the QA/legacy path (manual scenario-setting,
 * step-by-step advance); event→state translation delegates to the shared
 * `MailboxProvisioningEventApplier` so this never diverges from
 * `ConfigureMailboxUseCase`/`UpdateMailboxConfigurationUseCase`'s own
 * post-commit handling.
 */
@Injectable()
export class MailboxProvisioningService {
  constructor(
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    private readonly integration: IntegrationService,
    private readonly simulatedAdapter: SimulatedMailEngineAdapter,
    private readonly eventApplier: MailboxProvisioningEventApplier,
  ) {}

  async requestProvisioning(
    organizationId: string,
    mailboxId: string,
    actorId: string,
    idempotencyKey?: string,
  ): Promise<{ mailbox: Mailbox; command: IntegrationCommand; duplicate: boolean }> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    if (!mailbox.imap || !mailbox.smtp) {
      throw new ConflictException(
        'Esta cuenta está vinculada por token del servidor motor; no admite aprovisionamiento manual de credenciales.',
      );
    }
    if (!mailbox.clientId || !mailbox.domainId) {
      throw new ConflictException(
        'La cuenta debe estar vinculada a un cliente y a un dominio antes de solicitar el aprovisionamiento.',
      );
    }

    const payload = {
      clientId: mailbox.clientId,
      domainId: mailbox.domainId,
      mailboxId: mailbox.id,
      mailbox: {
        email: mailbox.email,
        displayName: mailbox.fromName,
        replyTo: mailbox.replyTo,
        timezone: mailbox.timezone,
        imap: {
          host: mailbox.imap.host,
          port: mailbox.imap.port,
          secure: mailbox.imap.encryption !== 'NONE',
          username: mailbox.imap.username,
          credentialReference: this.fakeCredentialReference(mailbox.id, 'imap'),
        },
        smtp: {
          host: mailbox.smtp.host,
          port: mailbox.smtp.port,
          secure: mailbox.smtp.encryption !== 'NONE',
          username: mailbox.smtp.username,
          credentialReference: this.fakeCredentialReference(mailbox.id, 'smtp'),
        },
        sendingLimits: mailbox.sendingLimits,
      },
    };

    const { command, duplicate } = await this.integration.submit(
      {
        organizationId,
        commandType: 'MAILBOX_PROVISION_REQUESTED',
        aggregateType: 'MAILBOX',
        aggregateId: mailbox.id,
        payload,
        requestedBy: actorId,
        idempotencyKey: idempotencyKey ?? `mailbox-provision:${mailbox.id}:${randomUUID()}`,
      },
      actorId,
    );

    if (!duplicate) {
      await this.mailboxes.update(mailbox.id, {
        provisioningStatus: 'PROVISION_REQUESTED',
        lastProvisionCommandId: command.commandId,
      });
    }

    return { mailbox: await this.getOwnedMailbox(organizationId, mailboxId), command, duplicate };
  }

  /** Picks the scenario the NEXT provisioning simulation for this mailbox will follow — set before calling `advance`. */
  setScenario(commandId: string, scenario: MailboxProvisionScenario): void {
    this.simulatedAdapter.setMailboxScenario(commandId, scenario);
  }

  async advance(
    organizationId: string,
    mailboxId: string,
    mode: 'ONE' | 'ALL',
    actorId: string,
  ): Promise<{ mailbox: Mailbox; events: IntegrationEvent[] }> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    if (!mailbox.lastProvisionCommandId) {
      throw new NotFoundException('Esta cuenta no tiene una solicitud de aprovisionamiento activa.');
    }

    const events = await this.integration.advance(organizationId, mailbox.lastProvisionCommandId, mode, actorId);
    for (const event of events) {
      await this.eventApplier.apply(organizationId, mailbox, event, actorId);
    }

    return { mailbox: await this.getOwnedMailbox(organizationId, mailboxId), events };
  }

  /** §10 — never the real secret, just a stable, obviously-fake vault reference. */
  private fakeCredentialReference(mailboxId: string, kind: 'imap' | 'smtp'): string {
    return `secret_ref_demo_${mailboxId.slice(0, 8)}_${kind}`;
  }

  private async getOwnedMailbox(organizationId: string, mailboxId: string): Promise<Mailbox> {
    const mailbox = await this.mailboxes.findById(mailboxId);
    if (!mailbox || mailbox.organizationId !== organizationId) {
      throw new NotFoundException('Mailbox not found.');
    }
    return mailbox;
  }
}
