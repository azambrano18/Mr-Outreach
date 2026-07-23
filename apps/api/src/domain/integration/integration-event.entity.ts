import { EventType } from './envelopes';

export type EventProcessingStatus = 'RECEIVED' | 'PROCESSED' | 'FAILED';

/** The persisted Inbox row — §45. */
export interface IntegrationEvent {
  id: string;
  organizationId: string;
  eventId: string;
  eventType: EventType;
  commandId: string | null;
  correlationId: string;
  schemaVersion: string;
  payload: Record<string, unknown>;
  status: EventProcessingStatus;
  /** Where the event came from — paired with eventId for the dedupe key (§45: "event_id + origen"). */
  origin: 'SIMULATED' | 'REMOTE';
  receivedAt: Date;
  processedAt: Date | null;
  processingError: string | null;
}

export interface CreateIntegrationEventInput {
  organizationId: string;
  eventId: string;
  eventType: EventType;
  commandId: string | null;
  correlationId: string;
  schemaVersion: string;
  payload: Record<string, unknown>;
  origin: 'SIMULATED' | 'REMOTE';
}

export interface UpdateIntegrationEventInput {
  status?: EventProcessingStatus;
  processedAt?: Date | null;
  processingError?: string | null;
}
