import { TransactionContext } from '../persistence/transaction';
import {
  CreateSequenceImportRowInput,
  NormalizedImportRowData,
  SequenceImportRow,
  UpdateSequenceImportRowInput,
} from './sequence-import-row.entity';

export interface SequenceImportRowFilter {
  validationStatus?: string;
}

export interface BulkRowResult {
  rowId: string;
  contactId: string;
  normalizedData: NormalizedImportRowData;
}

export interface SequenceImportRowRepository {
  findById(id: string): Promise<SequenceImportRow | null>;
  findByImport(
    organizationId: string,
    importId: string,
    filter?: SequenceImportRowFilter,
    ctx?: TransactionContext,
  ): Promise<SequenceImportRow[]>;
  /** Replaces any prior rows for this import — setMappingAndValidate() can be called more than once (re-mapping). */
  replaceForImport(
    organizationId: string,
    importId: string,
    rows: CreateSequenceImportRowInput[],
  ): Promise<SequenceImportRow[]>;
  update(id: string, input: UpdateSequenceImportRowInput): Promise<SequenceImportRow>;
  /**
   * Fase 2, Caso B — one statement for every row materialized in a batch
   * (never one UPDATE per row — see §"no debe existir una consulta SQL
   * individual por cada fila"). Sets contactId + the row's final
   * normalizedData (including extracted custom fields) together.
   */
  bulkSetContactAndNormalizedData(updates: BulkRowResult[], ctx?: TransactionContext): Promise<void>;
}
