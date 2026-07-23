import { Injectable } from '@nestjs/common';
import { EventEnvelope, EventType } from '../../../domain/integration/envelopes';
import { IntegrationCommand } from '../../../domain/integration/integration-command.entity';
import { MailEnginePort } from '../../../domain/integration/mail-engine-port';
import { ImportScenario } from '../../../domain/sequence-import/sequence-import.entity';

/** §41 "Cuenta" scenarios — lives here, not on the Mailbox entity, since it's simulation-only and never persisted as mailbox state. */
export type MailboxProvisionScenario =
  | 'SUCCESS'
  | 'IMAP_ERROR'
  | 'SMTP_ERROR'
  | 'AUTH_ERROR'
  | 'TIMEOUT'
  | 'GENERAL_FAILURE';

/** §23/§26 — lets the demo show a sequence that fails to publish, without a real engine round-trip. */
export type PublishScenario = 'SUCCESS' | 'FAILED' | 'TIMEOUT';

const DEFAULT_MAILBOX_SCENARIO: MailboxProvisionScenario = 'SUCCESS';
const DEFAULT_IMPORT_SCENARIO: ImportScenario = 'ALL_ACCEPTED';
const DEFAULT_PUBLISH_SCENARIO: PublishScenario = 'SUCCESS';

/**
 * `eventId` is derived from `commandId` + position (`evt_{commandId}_{n}`)
 * rather than randomUUID — planEvents must return the exact same events on
 * every call for the same command so IntegrationService can diff "already
 * recorded" vs "not yet recorded" across repeated manual-advance calls
 * without needing its own separate pointer/cursor state.
 */
function eventPlanner(command: IntegrationCommand) {
  let index = 0;
  return (eventType: EventType, payload: Record<string, unknown>, occurredAt: Date): EventEnvelope => {
    index += 1;
    return {
      schemaVersion: '1.0',
      eventId: `evt_${command.commandId}_${index}`,
      eventType,
      commandId: command.commandId,
      correlationId: command.correlationId,
      organizationId: command.organizationId,
      occurredAt: occurredAt.toISOString(),
      payload,
    };
  };
}

/**
 * §3: reuses the exact same command/event contracts a real remote engine
 * would use — the only thing that's "fake" here is that no network call
 * happens and the engine's internal decisions (does IMAP connect? how many
 * rows were duplicates?) come from an explicitly chosen scenario instead
 * of a real mail server / a real spreadsheet's contents.
 *
 * `planEvents` is deliberately a *pure* function of (command, scenario) —
 * no side effects, no mutation of Mailbox/Sequence/etc. Applying those
 * side effects is `IntegrationService`'s job (via the Inbox), exactly the
 * separation a real remote engine would force: the engine only ever tells
 * Mr Outreach "here is what happened", it never reaches into Mr
 * Outreach's own database.
 */
@Injectable()
export class SimulatedMailEngineAdapter implements MailEnginePort {
  private readonly mailboxScenarios = new Map<string, MailboxProvisionScenario>();
  private readonly importScenarios = new Map<string, ImportScenario>();
  private readonly publishScenarios = new Map<string, PublishScenario>();

  setMailboxScenario(commandId: string, scenario: MailboxProvisionScenario): void {
    this.mailboxScenarios.set(commandId, scenario);
  }

  setImportScenario(commandId: string, scenario: ImportScenario): void {
    this.importScenarios.set(commandId, scenario);
  }

  setPublishScenario(commandId: string, scenario: PublishScenario): void {
    this.publishScenarios.set(commandId, scenario);
  }

  async submitCommand(): Promise<{ accepted: boolean }> {
    // The simulated "engine" always accepts a well-formed command into its
    // own queue — rejection scenarios (IMAP error, invalid rows, etc.)
    // surface later as events, exactly like a real async engine would.
    return { accepted: true };
  }

  async getCommandStatus(): Promise<string | null> {
    return null; // see MailEnginePort's doc comment — simulation tracks status via the Outbox directly.
  }

  async getMailboxStatus(): Promise<Record<string, unknown> | null> {
    return null;
  }

  async getImportStatus(): Promise<string | null> {
    return null;
  }

  async getSequenceStatus(): Promise<Record<string, unknown> | null> {
    return null;
  }

  /** The ordered list of events this command will eventually produce — §11, §20, §42. */
  planEvents(command: IntegrationCommand): EventEnvelope[] {
    switch (command.commandType) {
      case 'MAILBOX_PROVISION_REQUESTED':
        return this.planMailboxProvisionEvents(command);
      case 'SEQUENCE_PUBLISH_REQUESTED':
        return this.planSequencePublishEvents(command);
      case 'SEQUENCE_IMPORT_REQUESTED':
        return this.planSequenceImportEvents(command);
      case 'SEQUENCE_CONTACT_REMOVE_REQUESTED':
        return this.planContactRemoveEvents(command);
      case 'SEQUENCE_COMPANY_REMOVE_REQUESTED':
        return this.planCompanyRemoveEvents(command);
      case 'PROSPECT_SEQUENCE_ACTION':
        return this.planProspectActionEvents(command);
      default:
        return [];
    }
  }

  private planMailboxProvisionEvents(command: IntegrationCommand): EventEnvelope[] {
    const scenario = this.mailboxScenarios.get(command.commandId) ?? DEFAULT_MAILBOX_SCENARIO;
    const payload = command.payload as { mailboxId: string };
    const t0 = command.createdAt;
    const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
    const makeEvent = eventPlanner(command);
    const events: EventEnvelope[] = [
      makeEvent('MAILBOX_PROVISION_ACCEPTED', { mailboxId: payload.mailboxId }, at(1)),
      makeEvent('MAILBOX_PROVISION_STARTED', { mailboxId: payload.mailboxId }, at(2)),
    ];

    if (scenario === 'TIMEOUT') {
      events.push(
        makeEvent(
          'MAILBOX_PROVISION_FAILED',
          { mailboxId: payload.mailboxId, reason: 'TIMEOUT', message: 'El motor no respondió a tiempo.' },
          at(90),
        ),
      );
      return events;
    }

    const imapOk = scenario !== 'IMAP_ERROR' && scenario !== 'AUTH_ERROR' && scenario !== 'GENERAL_FAILURE';
    if (imapOk) {
      events.push(
        makeEvent('MAILBOX_IMAP_VALIDATED', { mailboxId: payload.mailboxId, imapStatus: 'CONNECTED' }, at(4)),
      );
    } else {
      events.push(
        makeEvent(
          'MAILBOX_PROVISION_FAILED',
          {
            mailboxId: payload.mailboxId,
            reason: scenario,
            message:
              scenario === 'AUTH_ERROR'
                ? 'Autenticación IMAP/SMTP rechazada.'
                : scenario === 'IMAP_ERROR'
                  ? 'No se pudo establecer conexión IMAP.'
                  : 'Fallo general del motor durante el aprovisionamiento.',
          },
          at(4),
        ),
      );
      return events;
    }

    const smtpOk = scenario !== 'SMTP_ERROR';
    if (smtpOk) {
      events.push(
        makeEvent('MAILBOX_SMTP_VALIDATED', { mailboxId: payload.mailboxId, smtpStatus: 'CONNECTED' }, at(6)),
      );
    } else {
      events.push(
        makeEvent(
          'MAILBOX_PROVISION_FAILED',
          { mailboxId: payload.mailboxId, reason: scenario, message: 'No se pudo establecer conexión SMTP.' },
          at(6),
        ),
      );
      return events;
    }

    events.push(
      makeEvent(
        'MAILBOX_PROVISION_COMPLETED',
        {
          mailboxId: payload.mailboxId,
          imapStatus: 'CONNECTED',
          smtpStatus: 'CONNECTED',
          operationalStatus: 'READY',
        },
        at(8),
      ),
    );
    return events;
  }

  private planSequencePublishEvents(command: IntegrationCommand): EventEnvelope[] {
    const scenario = this.publishScenarios.get(command.commandId) ?? DEFAULT_PUBLISH_SCENARIO;
    const payload = command.payload as { sequenceId: string; sequenceVersion: number };
    const t0 = command.createdAt;
    const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
    const makeEvent = eventPlanner(command);
    const events: EventEnvelope[] = [
      makeEvent(
        'SEQUENCE_PUBLISH_ACCEPTED',
        { sequenceId: payload.sequenceId, sequenceVersion: payload.sequenceVersion },
        at(1),
      ),
    ];

    if (scenario === 'TIMEOUT') {
      events.push(
        makeEvent(
          'SEQUENCE_PUBLISH_FAILED',
          { sequenceId: payload.sequenceId, reason: 'TIMEOUT', message: 'El motor no respondió a tiempo.' },
          at(60),
        ),
      );
      return events;
    }
    if (scenario === 'FAILED') {
      events.push(
        makeEvent(
          'SEQUENCE_PUBLISH_FAILED',
          { sequenceId: payload.sequenceId, reason: 'GENERAL_FAILURE', message: 'Fallo general del motor al publicar la secuencia.' },
          at(2),
        ),
      );
      return events;
    }

    events.push(
      makeEvent(
        'SEQUENCE_PUBLISH_COMPLETED',
        { sequenceId: payload.sequenceId, sequenceVersion: payload.sequenceVersion, status: 'PUBLISHED' },
        at(2),
      ),
    );
    return events;
  }

  private planSequenceImportEvents(command: IntegrationCommand): EventEnvelope[] {
    const scenario = this.importScenarios.get(command.commandId) ?? DEFAULT_IMPORT_SCENARIO;
    const payload = command.payload as { importId: string };
    const t0 = command.createdAt;
    const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
    const makeEvent = eventPlanner(command);
    const events: EventEnvelope[] = [
      makeEvent('SEQUENCE_IMPORT_ACCEPTED', { importId: payload.importId }, at(1)),
      makeEvent('SEQUENCE_IMPORT_PROCESSING', { importId: payload.importId }, at(2)),
    ];

    if (scenario === 'TIMEOUT') {
      events.push(
        makeEvent(
          'SEQUENCE_IMPORT_FAILED',
          { importId: payload.importId, reason: 'TIMEOUT', message: 'El motor no respondió a tiempo.' },
          at(60),
        ),
      );
      return events;
    }
    if (scenario === 'FAILED') {
      events.push(
        makeEvent(
          'SEQUENCE_IMPORT_FAILED',
          { importId: payload.importId, reason: 'GENERAL_FAILURE', message: 'Fallo general al procesar la base.' },
          at(4),
        ),
      );
      return events;
    }

    events.push(makeEvent('SEQUENCE_IMPORT_BATCH_COMPLETED', { importId: payload.importId, batchNumber: 1 }, at(4)));

    const finalEventType: EventType =
      scenario === 'PARTIALLY_COMPLETED' ? 'SEQUENCE_IMPORT_PARTIALLY_COMPLETED' : 'SEQUENCE_IMPORT_COMPLETED';
    events.push(makeEvent(finalEventType, { importId: payload.importId, scenario }, at(6)));
    return events;
  }

  private planContactRemoveEvents(command: IntegrationCommand): EventEnvelope[] {
    const payload = command.payload as { sequenceContactId: string };
    const makeEvent = eventPlanner(command);
    return [
      makeEvent(
        'SEQUENCE_CONTACT_REMOVED',
        { sequenceContactId: payload.sequenceContactId },
        new Date(command.createdAt.getTime() + 1000),
      ),
    ];
  }

  private planCompanyRemoveEvents(command: IntegrationCommand): EventEnvelope[] {
    const payload = command.payload as { companyId: string };
    const makeEvent = eventPlanner(command);
    return [
      makeEvent(
        'SEQUENCE_COMPANY_REMOVED',
        { companyId: payload.companyId },
        new Date(command.createdAt.getTime() + 1000),
      ),
    ];
  }

  private planProspectActionEvents(command: IntegrationCommand): EventEnvelope[] {
    const payload = command.payload as { prospectId: string; sequenceId: string; action: string };
    const makeEvent = eventPlanner(command);
    return [
      makeEvent(
        'PROSPECT_SEQUENCE_ACTION_APPLIED',
        { prospectId: payload.prospectId, sequenceId: payload.sequenceId, action: payload.action },
        new Date(command.createdAt.getTime() + 1000),
      ),
    ];
  }
}
