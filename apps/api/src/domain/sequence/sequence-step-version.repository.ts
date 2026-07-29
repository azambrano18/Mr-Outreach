import { TransactionContext } from '../persistence/transaction';
import {
  CreateSequenceStepVersionInput,
  SequenceStepVersion,
} from './sequence-step-version.entity';

export interface SequenceStepVersionRepository {
  create(input: CreateSequenceStepVersionInput): Promise<SequenceStepVersion>;
  /** Most recent (highest versionNumber) first. */
  findByStep(sequenceStepId: string, ctx?: TransactionContext): Promise<SequenceStepVersion[]>;
}
