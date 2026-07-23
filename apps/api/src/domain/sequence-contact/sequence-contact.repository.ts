import {
  CreateSequenceContactInput,
  SequenceContact,
  UpdateSequenceContactInput,
} from './sequence-contact.entity';

export interface SequenceContactFilter {
  companyId?: string;
  status?: string;
}

export interface SequenceContactRepository {
  findById(id: string): Promise<SequenceContact | null>;
  findBySequence(
    organizationId: string,
    sequenceId: string,
    filter?: SequenceContactFilter,
  ): Promise<SequenceContact[]>;
  findByContactAndSequence(sequenceId: string, contactId: string): Promise<SequenceContact | null>;
  /** Every sequence this contact is enrolled in, across the whole organization — needed by "No contactar" (§DO_NOT_CONTACT), which must stop every active sequence, not just the one the conversation belongs to. */
  findByContact(organizationId: string, contactId: string): Promise<SequenceContact[]>;
  /** Every contact row across every sequence in the org — the admin global monitoring panel's stats source, fetched once and grouped in-memory per sequence to avoid an N+1 call per row. */
  findAllByOrganization(organizationId: string): Promise<SequenceContact[]>;
  create(input: CreateSequenceContactInput): Promise<SequenceContact>;
  update(id: string, input: UpdateSequenceContactInput): Promise<SequenceContact>;
}
