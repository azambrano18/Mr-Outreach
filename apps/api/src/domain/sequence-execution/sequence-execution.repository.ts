import { TransactionContext } from '../persistence/transaction';
import {
  CreateSequenceExecutionInput,
  SequenceExecution,
  SequenceExecutionStatus,
  UpdateSequenceExecutionInput,
} from './sequence-execution.entity';

export interface SequenceExecutionRepository {
  findById(id: string, ctx?: TransactionContext): Promise<SequenceExecution | null>;
  /** The executive's own "Gestiones" list. */
  findByExecutive(organizationId: string, executiveId: string): Promise<SequenceExecution[]>;
  /** Every execution in the org, regardless of executive — the admin read-only monitor's source list. */
  findAllByOrganization(organizationId: string): Promise<SequenceExecution[]>;
  create(input: CreateSequenceExecutionInput): Promise<SequenceExecution>;
  update(id: string, input: UpdateSequenceExecutionInput, ctx?: TransactionContext): Promise<SequenceExecution>;
  /** §10 — deletes a DRAFT Gestión; never called for a Gestión that has ever been submitted to the motor. */
  delete(id: string): Promise<void>;
  /**
   * Atomic claim so two concurrent "Iniciar gestión" attempts on the same
   * execution never both submit to the motor: succeeds (returns 1) only
   * when the current `status` is NOT one of `blockedStatuses`; returns 0
   * otherwise, which the caller must treat as a 409.
   */
  conditionalUpdateStatus(
    id: string,
    blockedStatuses: SequenceExecutionStatus[],
    toStatus: SequenceExecutionStatus,
    ctx?: TransactionContext,
  ): Promise<number>;
}
