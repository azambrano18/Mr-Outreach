import {
  CreateSequenceImportRowInput,
  SequenceImportRow,
  UpdateSequenceImportRowInput,
} from './sequence-import-row.entity';

export interface SequenceImportRowFilter {
  validationStatus?: string;
}

export interface SequenceImportRowRepository {
  findById(id: string): Promise<SequenceImportRow | null>;
  findByImport(
    organizationId: string,
    importId: string,
    filter?: SequenceImportRowFilter,
  ): Promise<SequenceImportRow[]>;
  /** Replaces any prior rows for this import — setMappingAndValidate() can be called more than once (re-mapping). */
  replaceForImport(
    organizationId: string,
    importId: string,
    rows: CreateSequenceImportRowInput[],
  ): Promise<SequenceImportRow[]>;
  update(id: string, input: UpdateSequenceImportRowInput): Promise<SequenceImportRow>;
}
