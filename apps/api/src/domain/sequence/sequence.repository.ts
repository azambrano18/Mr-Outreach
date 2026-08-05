import { TransactionContext } from '../persistence/transaction';
import { CreateSequenceInput, Sequence, SequencePublishStatus, UpdateSequenceInput } from './sequence.entity';

export interface SequenceRepository {
  findById(id: string, ctx?: TransactionContext): Promise<Sequence | null>;
  findByExecutive(organizationId: string, executiveId: string): Promise<Sequence[]>;
  findByClient(organizationId: string, clientId: string): Promise<Sequence[]>;
  /** Every non-deleted sequence in the org, regardless of executive — the admin global monitoring panel's source list. */
  findAllByOrganization(organizationId: string): Promise<Sequence[]>;
  create(input: CreateSequenceInput): Promise<Sequence>;
  update(id: string, input: UpdateSequenceInput, ctx?: TransactionContext): Promise<Sequence>;
  /**
   * Fase 2, Caso C — atomic claim so two concurrent "Publicar secuencia"
   * attempts on the same sequence never both proceed: succeeds (returns 1)
   * only when the current `publishStatus` is NOT one of `blockedStatuses`
   * (an in-flight publish); returns 0 otherwise, which the caller must treat
   * as a 409 rather than retrying the write.
   */
  conditionalUpdatePublishStatus(
    id: string,
    blockedStatuses: SequencePublishStatus[],
    toStatus: SequencePublishStatus,
    ctx?: TransactionContext,
  ): Promise<number>;
  /** "Conversaciones de prueba" (QA) — hard delete, never soft-delete: only ever called on the synthetic QA Sequence by DeleteSimulationConversationsUseCase. */
  delete(id: string, ctx?: TransactionContext): Promise<void>;
}
