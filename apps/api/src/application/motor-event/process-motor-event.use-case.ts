import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { IntegrationEvent } from '../../domain/integration/integration-event.entity';
import { IntegrationEventRepository } from '../../domain/integration/integration-event.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import {
  AUDIT_LOG_REPOSITORY,
  INTEGRATION_EVENT_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { MotorEventEnvelopeDto, MOTOR_EVENT_SCHEMA_VERSION } from '../../modules/integration/dto/motor-event-envelope.dto';
import { MotorEventProjectionError, MotorEventProjector } from './motor-event-projector.service';
import { validateMotorEventPayload } from './motor-event-payload.validator';

/** Fase 11 — after this many failed attempts, a retryable failure is downgraded to terminal rather than retried forever. */
export const MAX_PROJECTION_ATTEMPTS = 5;

export type ProcessMotorEventOutcome =
  | 'PROCESSED'
  | 'ALREADY_PROCESSED'
  | 'ALREADY_PROCESSING'
  | 'FAILED_RETRYABLE'
  | 'FAILED_TERMINAL'
  | 'INVALID_PAYLOAD';

export interface ProcessMotorEventResult {
  outcome: ProcessMotorEventOutcome;
  eventId: string;
  errors?: string[];
}

export interface ProcessMotorEventInput {
  envelope: MotorEventEnvelopeDto;
  origin: 'SIMULATED' | 'REMOTE';
}

/**
 * Fase "Recepción de eventos del motor" — the durable-receipt/retry
 * envelope shared by both the real HTTP endpoint and the dev-only
 * simulator (Fase 12: "usar el mismo caso de uso"). Never talks to the
 * motor itself — MotorEventProjector's side effects are pure local
 * database writes, so both stages below are safe to run as ordinary
 * transactions with no external call in between.
 *
 * ETAPA A: dedupe-and-receive, one transaction.
 * ETAPA B: claim-project-finalize, a second, separate transaction — kept
 * separate from Etapa A (rather than one bigger transaction) so a crash
 * between the two leaves a genuinely durable, inspectable RECEIVED row
 * instead of losing the receipt entirely.
 */
@Injectable()
export class ProcessMotorEventUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(INTEGRATION_EVENT_REPOSITORY) private readonly events: IntegrationEventRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly projector: MotorEventProjector,
  ) {}

  async execute(input: ProcessMotorEventInput): Promise<ProcessMotorEventResult> {
    const { envelope, origin } = input;

    if (envelope.schemaVersion !== MOTOR_EVENT_SCHEMA_VERSION) {
      return { outcome: 'INVALID_PAYLOAD', eventId: envelope.eventId, errors: [`schemaVersion no soportada: ${envelope.schemaVersion}`] };
    }
    const payloadValidation = validateMotorEventPayload(envelope.eventType, envelope.payload);
    if (!payloadValidation.valid) {
      return { outcome: 'INVALID_PAYLOAD', eventId: envelope.eventId, errors: payloadValidation.errors };
    }

    // ETAPA A — recepción durable, todo o nada.
    let event: IntegrationEvent;
    let alreadyTerminal: boolean;
    try {
      ({ event, alreadyTerminal } = await this.tx.run(async (ctx) => {
        const existing = await this.events.findByEventId(envelope.organizationId, envelope.eventId, origin, ctx);
        if (existing) {
          return { event: existing, alreadyTerminal: existing.status === 'PROCESSED' || existing.status === 'FAILED_TERMINAL' };
        }
        const created = await this.events.create(
          {
            organizationId: envelope.organizationId,
            eventId: envelope.eventId,
            eventType: envelope.eventType,
            commandId: envelope.commandId ?? null,
            correlationId: envelope.correlationId,
            schemaVersion: envelope.schemaVersion,
            aggregateType: envelope.aggregateType ?? null,
            aggregateId: envelope.aggregateId ?? null,
            payload: envelope.payload,
            origin,
            occurredAt: new Date(envelope.occurredAt),
          },
          ctx,
        );
        return { event: created, alreadyTerminal: false };
      }));
    } catch (error) {
      // Two truly concurrent deliveries of the same eventId can both pass the
      // findByEventId check above before either commits — the repository's
      // unique constraint is the real dedup guarantee. Postgres aborts the
      // whole transaction on that conflict, so the recovery lookup below
      // must run in a brand-new (ambient) connection, never the same ctx.
      if (!(error instanceof ConflictException)) throw error;
      const raceWinner = await this.events.findByEventId(envelope.organizationId, envelope.eventId, origin);
      if (!raceWinner) throw error;
      event = raceWinner;
      alreadyTerminal = raceWinner.status === 'PROCESSED' || raceWinner.status === 'FAILED_TERMINAL';
    }

    if (event.status === 'PROCESSED') {
      return { outcome: 'ALREADY_PROCESSED', eventId: event.eventId };
    }
    if (event.status === 'FAILED_TERMINAL') {
      return { outcome: 'FAILED_TERMINAL', eventId: event.eventId };
    }
    if (alreadyTerminal) {
      // Defensive — status changed between the two checks above under concurrency; treat as processed to stay idempotent.
      return { outcome: 'ALREADY_PROCESSED', eventId: event.eventId };
    }

    return this.attemptProjection(event);
  }

  /** Also the entry point for a manual admin retry of a FAILED_RETRYABLE event — see RetryMotorEventUseCase. */
  async attemptProjection(event: IntegrationEvent): Promise<ProcessMotorEventResult> {
    const claimed = await this.events.conditionalClaimForProcessing(event.id);
    if (claimed === 0) {
      // Another concurrent delivery/retry of the same eventId is already running the projector.
      return { outcome: 'ALREADY_PROCESSING', eventId: event.eventId };
    }

    // ETAPA B — proyección local, todo o nada. Sin llamadas externas dentro
    // de esta transacción — MotorEventProjector nunca llama al motor.
    try {
      await this.tx.run(async (ctx) => {
        await this.projector.project(event, ctx);
        await this.events.update(
          event.id,
          { status: 'PROCESSED', processedAt: new Date(), processingError: null, errorCode: null, attempts: event.attempts + 1 },
          ctx,
        );
      });
      return { outcome: 'PROCESSED', eventId: event.eventId };
    } catch (error) {
      const attempts = event.attempts + 1;
      const isProjectionError = error instanceof MotorEventProjectionError;
      const retryable = isProjectionError ? error.retryable : true; // unknown errors default to retryable — never assume terminal without evidence.
      const errorCode = isProjectionError ? error.errorCode : 'UNEXPECTED_ERROR';
      const message = error instanceof Error ? error.message : 'Error desconocido durante la proyección.';
      const terminal = !retryable || attempts >= MAX_PROJECTION_ATTEMPTS;

      await this.events.update(event.id, {
        status: terminal ? 'FAILED_TERMINAL' : 'FAILED_RETRYABLE',
        processingError: message,
        errorCode,
        failedAt: new Date(),
        attempts,
      });
      await this.auditLogs.record({
        organizationId: event.organizationId,
        actorId: null,
        action: 'integration_event.projection_failed',
        entityType: 'IntegrationEvent',
        entityId: event.id,
        metadata: { eventType: event.eventType, errorCode, attempts, terminal },
      });

      return { outcome: terminal ? 'FAILED_TERMINAL' : 'FAILED_RETRYABLE', eventId: event.eventId, errors: [message] };
    }
  }
}
