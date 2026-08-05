import { TransactionContext } from '../persistence/transaction';
import { CreateSimulationConversationBatchInput, SimulationConversationBatch } from './simulation-conversation-batch.entity';

export interface SimulationConversationBatchRepository {
  findById(id: string, ctx?: TransactionContext): Promise<SimulationConversationBatch | null>;
  findByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<SimulationConversationBatch | null>;
  /** §13 — only one batch may be active per organization at a time; null when none exists. */
  findActiveByOrganization(organizationId: string): Promise<SimulationConversationBatch | null>;
  create(input: CreateSimulationConversationBatchInput, ctx?: TransactionContext): Promise<SimulationConversationBatch>;
  delete(id: string, ctx?: TransactionContext): Promise<void>;
}
