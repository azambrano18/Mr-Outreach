import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { COMMAND_SCHEMA_VERSION, CommandEnvelope, CommandType, EventType } from '../../domain/integration/envelopes';
import {
  AggregateType,
  CommandStatus,
  IntegrationCommand,
} from '../../domain/integration/integration-command.entity';
import {
  IntegrationCommandFilter,
  IntegrationCommandRepository,
} from '../../domain/integration/integration-command.repository';
import { IntegrationEvent } from '../../domain/integration/integration-event.entity';
import {
  IntegrationEventFilter,
  IntegrationEventRepository,
} from '../../domain/integration/integration-event.repository';
import { MAIL_ENGINE_PORT, MailEnginePort } from '../../domain/integration/mail-engine-port';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { SimulatedMailEngineAdapter } from '../../infrastructure/mail-engine/simulated/simulated-mail-engine-adapter';
import {
  AUDIT_LOG_REPOSITORY,
  INTEGRATION_COMMAND_REPOSITORY,
  INTEGRATION_EVENT_REPOSITORY,
} from '../../infrastructure/persistence/tokens';

export interface SubmitCommandInput {
  organizationId: string;
  commandType: CommandType;
  aggregateType: AggregateType;
  aggregateId: string;
  payload: Record<string, unknown>;
  requestedBy: string;
  idempotencyKey: string;
  correlationId?: string;
}

const REDACTED_KEYS = new Set(['password', 'secret', 'secretciphertext', 'apikey', 'token']);

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redactValue(val);
    }
    return out;
  }
  return value;
}

/** §11/§42 — terminal-ness of a simulated event, expressed as the Outbox status it drives. `null` means "no status change" (still PROCESSING). */
function deriveCommandStatus(eventType: EventType): CommandStatus | null {
  if (eventType.endsWith('_FAILED')) return 'FAILED';
  if (eventType.endsWith('_REMOVED')) return 'COMPLETED';
  if (eventType === 'SEQUENCE_IMPORT_PARTIALLY_COMPLETED') return 'COMPLETED';
  if (eventType.includes('BATCH_COMPLETED')) return 'PROCESSING';
  if (eventType.endsWith('_COMPLETED')) return 'COMPLETED';
  if (eventType.endsWith('_STARTED') || eventType.endsWith('_VALIDATED') || eventType.endsWith('_PROCESSING')) {
    return 'PROCESSING';
  }
  if (eventType.endsWith('_ACCEPTED')) return 'ACCEPTED';
  return null;
}

const TERMINAL_STATUSES: CommandStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'];

/**
 * §44-46 — the Outbox/Inbox mechanics shared by every command/event flow
 * this phase introduces (mailbox provisioning, sequence publish, imports,
 * contact/company removal). Deliberately has NO domain-specific side-effect
 * logic (no Mailbox/Sequence/SequenceImport mutation here) — that lives in
 * each feature's own service, which calls `submit`/`advance` and then reacts
 * to the returned events. Keeps this service reusable across every command
 * type without a growing switch statement, and mirrors how a real remote
 * engine would only ever hand back envelopes, never reach into this app's
 * tables directly.
 */
@Injectable()
export class IntegrationService {
  constructor(
    @Inject(INTEGRATION_COMMAND_REPOSITORY) private readonly commandRepo: IntegrationCommandRepository,
    @Inject(INTEGRATION_EVENT_REPOSITORY) private readonly eventRepo: IntegrationEventRepository,
    @Inject(MAIL_ENGINE_PORT) private readonly port: MailEnginePort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly config: AppConfigService,
    private readonly simulatedAdapter: SimulatedMailEngineAdapter,
  ) {}

  /** §10/§47 — used by the JSON viewer and by anything returning a command/payload to the frontend. */
  redact(payload: Record<string, unknown>): Record<string, unknown> {
    return redactValue(payload) as Record<string, unknown>;
  }

  /** §43 — duplicate submissions (same idempotencyKey) reuse the previous command instead of creating a new one or re-invoking the port. */
  async submit(
    input: SubmitCommandInput,
    actorId: string,
  ): Promise<{ command: IntegrationCommand; duplicate: boolean }> {
    const existing = await this.commandRepo.findByIdempotencyKey(input.organizationId, input.idempotencyKey);
    if (existing) {
      await this.auditLogs.record({
        organizationId: input.organizationId,
        actorId,
        action: 'integration_command.duplicate_detected',
        entityType: 'IntegrationCommand',
        entityId: existing.id,
        metadata: { commandType: input.commandType, idempotencyKey: input.idempotencyKey },
      });
      return { command: existing, duplicate: true };
    }

    const created = await this.commandRepo.create({
      organizationId: input.organizationId,
      commandId: `cmd_${randomUUID()}`,
      commandType: input.commandType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      schemaVersion: COMMAND_SCHEMA_VERSION,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId ?? `corr_${randomUUID()}`,
      payload: input.payload,
      requestedBy: input.requestedBy,
    });

    const result = await this.port.submitCommand(this.buildEnvelope(created));
    const updated = await this.commandRepo.update(created.id, {
      sentAt: new Date(),
      status: result.accepted ? 'ACCEPTED' : 'FAILED',
      acceptedAt: result.accepted ? new Date() : null,
      lastError: result.accepted ? null : 'El motor rechazó el comando.',
    });

    await this.auditLogs.record({
      organizationId: input.organizationId,
      actorId,
      action: 'integration_command.submit',
      entityType: 'IntegrationCommand',
      entityId: updated.id,
      metadata: {
        commandType: input.commandType,
        commandId: updated.commandId,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
      },
    });

    return { command: updated, duplicate: false };
  }

  /** The full deterministic event sequence the simulated engine will emit for this command — used by "Ver JSON" and by `advance`'s own diffing. */
  async listPlannedEvents(organizationId: string, commandId: string) {
    const command = await this.getOwnedCommand(organizationId, commandId);
    this.assertSimulationMode();
    return this.simulatedAdapter.planEvents(command);
  }

  /**
   * §42 — manual/automatic advancement. `mode: 'ONE'` records the next
   * not-yet-recorded planned event; `'ALL'` records every remaining one.
   * Safe to call repeatedly — already-recorded events (matched by eventId)
   * are never re-recorded, and once every planned event has landed, further
   * calls are a no-op.
   */
  async advance(
    organizationId: string,
    commandId: string,
    mode: 'ONE' | 'ALL',
    actorId: string,
  ): Promise<IntegrationEvent[]> {
    const command = await this.getOwnedCommand(organizationId, commandId);
    this.assertSimulationMode();

    const planned = this.simulatedAdapter.planEvents(command);
    const alreadyRecorded = await this.eventRepo.findAll(organizationId, { commandId: command.commandId });
    const recordedIds = new Set(alreadyRecorded.map((event) => event.eventId));
    const pending = planned.filter((envelope) => !recordedIds.has(envelope.eventId));
    const toApply = mode === 'ONE' ? pending.slice(0, 1) : pending;

    const recorded: IntegrationEvent[] = [];
    for (const envelope of toApply) {
      const event = await this.eventRepo.create({
        organizationId,
        eventId: envelope.eventId,
        eventType: envelope.eventType,
        commandId: envelope.commandId,
        correlationId: envelope.correlationId,
        schemaVersion: envelope.schemaVersion,
        payload: envelope.payload,
        origin: 'SIMULATED',
      });
      await this.eventRepo.update(event.id, { status: 'PROCESSED', processedAt: new Date() });
      recorded.push(event);

      const nextStatus = deriveCommandStatus(envelope.eventType);
      if (nextStatus) {
        await this.commandRepo.update(command.id, {
          status: nextStatus,
          ...(TERMINAL_STATUSES.includes(nextStatus) ? { completedAt: new Date() } : {}),
        });
      }
    }

    if (recorded.length > 0) {
      await this.auditLogs.record({
        organizationId,
        actorId,
        action: 'integration_event.simulate',
        entityType: 'IntegrationCommand',
        entityId: command.id,
        metadata: { commandId: command.commandId, eventTypes: recorded.map((event) => event.eventType) },
      });
    }

    return recorded;
  }

  /**
   * §33-36 — for events with no originating command (a real engine detects
   * a reply/bounce during IMAP polling and pushes it unsolicited, the same
   * way ReplySimulationService does here). Skips the Outbox entirely;
   * writes straight to the Inbox with `commandId: null`.
   */
  async recordDirectEvent(
    organizationId: string,
    eventType: EventType,
    payload: Record<string, unknown>,
    actorId: string,
    correlationId?: string,
  ): Promise<IntegrationEvent> {
    const event = await this.eventRepo.create({
      organizationId,
      eventId: `evt_${randomUUID()}`,
      eventType,
      commandId: null,
      correlationId: correlationId ?? `corr_${randomUUID()}`,
      schemaVersion: COMMAND_SCHEMA_VERSION,
      payload,
      origin: 'SIMULATED',
    });
    await this.eventRepo.update(event.id, { status: 'PROCESSED', processedAt: new Date() });
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'integration_event.simulate_direct',
      entityType: 'IntegrationEvent',
      entityId: event.id,
      metadata: { eventType },
    });
    return event;
  }

  async getCommand(organizationId: string, commandId: string): Promise<IntegrationCommand> {
    return this.getOwnedCommand(organizationId, commandId);
  }

  async listCommands(
    organizationId: string,
    filter?: IntegrationCommandFilter,
  ): Promise<IntegrationCommand[]> {
    return this.commandRepo.findAll(organizationId, filter);
  }

  async listEvents(organizationId: string, filter?: IntegrationEventFilter): Promise<IntegrationEvent[]> {
    return this.eventRepo.findAll(organizationId, filter);
  }

  async listEventsForCommand(organizationId: string, commandId: string): Promise<IntegrationEvent[]> {
    return this.eventRepo.findAll(organizationId, { commandId });
  }

  /**
   * §40's "Reprocesar evento" — idempotent by design: this simulation
   * already applies each event's side effects exactly once at record time
   * (see MailboxProvisioningService/SequenceImportsService/etc.'s
   * `applyEvent`), so reprocessing re-marks the Inbox row as processed and
   * audits the action without re-running side effects a second time.
   */
  async reprocessEvent(organizationId: string, eventId: string, actorId: string): Promise<IntegrationEvent> {
    const event = await this.eventRepo.findById(eventId);
    if (!event || event.organizationId !== organizationId) {
      throw new NotFoundException('Event not found.');
    }
    const updated = await this.eventRepo.update(event.id, {
      status: 'PROCESSED',
      processedAt: new Date(),
      processingError: null,
    });
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'integration_event.reprocess',
      entityType: 'IntegrationEvent',
      entityId: event.id,
      metadata: { eventType: event.eventType },
    });
    return updated;
  }

  buildEnvelope(command: IntegrationCommand): CommandEnvelope {
    return {
      schemaVersion: command.schemaVersion,
      commandId: command.commandId,
      commandType: command.commandType,
      idempotencyKey: command.idempotencyKey,
      organizationId: command.organizationId,
      correlationId: command.correlationId,
      requestedBy: command.requestedBy,
      requestedAt: command.createdAt.toISOString(),
      payload: command.payload,
    };
  }

  private async getOwnedCommand(organizationId: string, commandId: string): Promise<IntegrationCommand> {
    const command = await this.commandRepo.findByCommandId(organizationId, commandId);
    if (!command) throw new NotFoundException('Comando no encontrado.');
    return command;
  }

  private assertSimulationMode(): void {
    if (this.config.mailEngineMode !== 'simulation') {
      throw new ConflictException('El avance manual de eventos solo está disponible en modo simulación.');
    }
  }
}
