import { TransactionContext } from '../persistence/transaction';
import {
  CreateIntegrationEventInput,
  IntegrationEvent,
  UpdateIntegrationEventInput,
} from './integration-event.entity';

export interface IntegrationEventFilter {
  eventType?: string;
  status?: string;
  commandId?: string;
  aggregateType?: string;
  aggregateId?: string;
}

export interface IntegrationEventRepository {
  findById(id: string, ctx?: TransactionContext): Promise<IntegrationEvent | null>;
  /** Dedupe key is eventId + origin — §45. */
  findByEventId(
    organizationId: string,
    eventId: string,
    origin: 'SIMULATED' | 'REMOTE',
    ctx?: TransactionContext,
  ): Promise<IntegrationEvent | null>;
  findAll(organizationId: string, filter?: IntegrationEventFilter): Promise<IntegrationEvent[]>;
  create(input: CreateIntegrationEventInput, ctx?: TransactionContext): Promise<IntegrationEvent>;
  update(id: string, input: UpdateIntegrationEventInput, ctx?: TransactionContext): Promise<IntegrationEvent>;
  /** Atomic claim so two concurrent deliveries/retries of the same eventId never both run the projector: succeeds (returns 1) only when status is currently RECEIVED or FAILED_RETRYABLE. */
  conditionalClaimForProcessing(id: string, ctx?: TransactionContext): Promise<number>;
}
