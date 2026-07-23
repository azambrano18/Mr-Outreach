import { CreateSequenceInput, Sequence, UpdateSequenceInput } from './sequence.entity';

export interface SequenceRepository {
  findById(id: string): Promise<Sequence | null>;
  findByExecutive(organizationId: string, executiveId: string): Promise<Sequence[]>;
  findByClient(organizationId: string, clientId: string): Promise<Sequence[]>;
  /** Every non-deleted sequence in the org, regardless of executive — the admin global monitoring panel's source list. */
  findAllByOrganization(organizationId: string): Promise<Sequence[]>;
  create(input: CreateSequenceInput): Promise<Sequence>;
  update(id: string, input: UpdateSequenceInput): Promise<Sequence>;
}
