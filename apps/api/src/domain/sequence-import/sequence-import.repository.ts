import {
  CreateSequenceImportInput,
  SequenceImport,
  UpdateSequenceImportInput,
} from './sequence-import.entity';

export interface SequenceImportRepository {
  findById(id: string): Promise<SequenceImport | null>;
  findBySequence(organizationId: string, sequenceId: string): Promise<SequenceImport[]>;
  create(input: CreateSequenceImportInput): Promise<SequenceImport>;
  update(id: string, input: UpdateSequenceImportInput): Promise<SequenceImport>;
}
