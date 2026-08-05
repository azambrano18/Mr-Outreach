import { TransactionContext } from '../persistence/transaction';
import {
  CreateSequenceExecutionInput,
  SequenceExecution,
  SequenceExecutionStatus,
  UpdateSequenceExecutionInput,
} from './sequence-execution.entity';

export interface SequenceExecutionRepository {
  findById(id: string, ctx?: TransactionContext): Promise<SequenceExecution | null>;
  /** Fase "Recepción de eventos del motor" — resolves the motor's own execution id back to the local row, for events that arrive keyed by serverExecutionId rather than aggregateId. */
  findByServerExecutionId(serverExecutionId: string, ctx?: TransactionContext): Promise<SequenceExecution | null>;
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
  /**
   * Fase "Control operativo de Gestiones" — the allow-list mirror of
   * `conditionalUpdateStatus` above, used by pause/resume/stop: succeeds
   * (returns 1) only when the current `status` IS one of
   * `allowedFromStatuses`; returns 0 otherwise (caller throws 409). An
   * allow-list reads far more safely here than a block-list would — the
   * status enum keeps growing, and a pause/resume/stop transition should
   * only ever leave one specific, named starting state, never "every
   * status except these few".
   */
  conditionalUpdateStatusFromAllowed(
    id: string,
    allowedFromStatuses: SequenceExecutionStatus[],
    toStatus: SequenceExecutionStatus,
    ctx?: TransactionContext,
  ): Promise<number>;
}
