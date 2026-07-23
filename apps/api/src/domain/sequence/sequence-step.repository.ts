import {
  CreateSequenceStepInput,
  SequenceStep,
  UpdateSequenceStepInput,
} from './sequence-step.entity';

export interface SequenceStepRepository {
  findById(id: string): Promise<SequenceStep | null>;
  /** Ordered by position ascending. */
  findBySequence(sequenceId: string): Promise<SequenceStep[]>;
  /** Every non-deleted step across every sequence in the org — used to check whether a variable key is still referenced anywhere before allowing its catalog entry to be deleted. */
  findAllByOrganization(organizationId: string): Promise<SequenceStep[]>;
  create(input: CreateSequenceStepInput): Promise<SequenceStep>;
  update(id: string, input: UpdateSequenceStepInput): Promise<SequenceStep>;
  remove(id: string): Promise<void>;
}
