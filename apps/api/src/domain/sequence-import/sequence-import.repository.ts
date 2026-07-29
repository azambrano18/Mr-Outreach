import { TransactionContext } from '../persistence/transaction';
import {
  CreateSequenceImportInput,
  SequenceImport,
  UpdateSequenceImportInput,
} from './sequence-import.entity';

export interface SequenceImportRepository {
  findById(id: string, ctx?: TransactionContext): Promise<SequenceImport | null>;
  findBySequence(organizationId: string, sequenceId: string): Promise<SequenceImport[]>;
  create(input: CreateSequenceImportInput): Promise<SequenceImport>;
  update(id: string, input: UpdateSequenceImportInput, ctx?: TransactionContext): Promise<SequenceImport>;
  /**
   * Fase 2, Caso B — atomic claim: only succeeds (count === 1) if the
   * import is still in `fromStatus`. Used as the first write inside the
   * confirm transaction so two concurrent confirmations of the same
   * import can never both proceed — the loser sees count 0 and must
   * treat it as "someone else may already be confirming/have confirmed".
   */
  conditionalUpdateStatus(
    id: string,
    fromStatus: string,
    toStatus: string,
    ctx?: TransactionContext,
  ): Promise<number>;
}
