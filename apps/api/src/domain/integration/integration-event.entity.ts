import { AggregateType } from './integration-command.entity';
import { EventType } from './envelopes';

/**
 * Fase "Recepción de eventos del motor" — RECEIVED/PROCESSED/FAILED are the
 * original, legacy-simulated-flow states (kept unchanged, still used by
 * IntegrationService.advance()/recordDirectEvent()). PROCESSING/
 * FAILED_RETRYABLE/FAILED_TERMINAL are new, used only by the active-flow
 * motor-event receiver, which needs to distinguish "currently projecting"
 * from "done" and a transient failure (safe to retry) from a permanent one
 * (never retried automatically).
 */
export type EventProcessingStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL';

/** The persisted Inbox row — §45. */
export interface IntegrationEvent {
  id: string;
  organizationId: string;
  eventId: string;
  eventType: EventType;
  commandId: string | null;
  correlationId: string;
  schemaVersion: string;
  /** Null for legacy events (resolved via commandId instead) — always set for active-flow motor events. */
  aggregateType: AggregateType | null;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  status: EventProcessingStatus;
  /** Where the event came from — paired with eventId for the dedupe key (§45: "event_id + origen"). */
  origin: 'SIMULATED' | 'REMOTE';
  /** When the motor says the event happened — distinct from receivedAt (when Mr Outreach received it). Null for legacy events, which never carried this. */
  occurredAt: Date | null;
  receivedAt: Date;
  processedAt: Date | null;
  processingError: string | null;
  /** Structured code for FAILED_RETRYABLE/FAILED_TERMINAL classification — separate from the free-text processingError. */
  errorCode: string | null;
  failedAt: Date | null;
  /** Number of projection attempts — incremented on every Etapa B run, including retries. */
  attempts: number;
}

export interface CreateIntegrationEventInput {
  organizationId: string;
  eventId: string;
  eventType: EventType;
  commandId: string | null;
  correlationId: string;
  schemaVersion: string;
  aggregateType?: AggregateType | null;
  aggregateId?: string | null;
  payload: Record<string, unknown>;
  origin: 'SIMULATED' | 'REMOTE';
  occurredAt?: Date | null;
}

export interface UpdateIntegrationEventInput {
  status?: EventProcessingStatus;
  processedAt?: Date | null;
  processingError?: string | null;
  errorCode?: string | null;
  failedAt?: Date | null;
  attempts?: number;
}
