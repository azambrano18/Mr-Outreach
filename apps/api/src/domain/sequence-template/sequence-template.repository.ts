import { TransactionContext } from '../persistence/transaction';
import {
  CreateSequenceTemplateInput,
  SequenceTemplate,
  SequenceTemplateStatus,
  UpdateSequenceTemplateInput,
} from './sequence-template.entity';

export interface SequenceTemplateRepository {
  findById(id: string, ctx?: TransactionContext): Promise<SequenceTemplate | null>;
  /** Every non-archived-hidden template owned by this executive — the "Plantillas" list. */
  findByOwner(organizationId: string, ownerUserId: string): Promise<SequenceTemplate[]>;
  findByMailbox(organizationId: string, mailboxId: string): Promise<SequenceTemplate[]>;
  create(input: CreateSequenceTemplateInput): Promise<SequenceTemplate>;
  update(id: string, input: UpdateSequenceTemplateInput, ctx?: TransactionContext): Promise<SequenceTemplate>;
  /** §8 — hard delete; only ever called for a template that was never published (no versions/executions reference it). */
  delete(id: string): Promise<void>;
  /**
   * Atomic claim so two concurrent "Publicar" attempts on the same template
   * never both proceed: succeeds (returns 1) only when the current `status`
   * is NOT one of `blockedStatuses`; returns 0 otherwise, which the caller
   * must treat as a 409 rather than retrying the write. Mirrors
   * SequenceRepository.conditionalUpdatePublishStatus.
   */
  conditionalUpdateStatus(
    id: string,
    blockedStatuses: SequenceTemplateStatus[],
    toStatus: SequenceTemplateStatus,
    ctx?: TransactionContext,
  ): Promise<number>;
}
