import {
  CreateIntegrationEventInput,
  IntegrationEvent,
  UpdateIntegrationEventInput,
} from './integration-event.entity';

export interface IntegrationEventFilter {
  eventType?: string;
  status?: string;
  commandId?: string;
}

export interface IntegrationEventRepository {
  findById(id: string): Promise<IntegrationEvent | null>;
  /** Dedupe key is eventId + origin — §45. */
  findByEventId(
    organizationId: string,
    eventId: string,
    origin: 'SIMULATED' | 'REMOTE',
  ): Promise<IntegrationEvent | null>;
  findAll(organizationId: string, filter?: IntegrationEventFilter): Promise<IntegrationEvent[]>;
  create(input: CreateIntegrationEventInput): Promise<IntegrationEvent>;
  update(id: string, input: UpdateIntegrationEventInput): Promise<IntegrationEvent>;
}
