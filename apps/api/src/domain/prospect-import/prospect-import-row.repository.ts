import { CreateProspectImportRowInput, ProspectExecutionState, ProspectImportRow } from './prospect-import-row.entity';

export interface ProspectImportRowRepository {
  findByImport(importId: string): Promise<ProspectImportRow[]>;
  createMany(inputs: CreateProspectImportRowInput[]): Promise<ProspectImportRow[]>;
  /** Replaces every row for this import — used when the executive re-maps columns. */
  replaceForImport(importId: string, inputs: CreateProspectImportRowInput[]): Promise<ProspectImportRow[]>;
  /** §10 — deletes every row for this import; used when a DRAFT Gestión (and its temp import) is deleted. */
  deleteByImport(importId: string): Promise<void>;
  /** §2/§11 — stamps every VALID row of this import with the server-reported (or contractually-defaulted) initial execution state, right after the Gestión is accepted. */
  markValidRowsExecutionState(importId: string, state: ProspectExecutionState): Promise<void>;
}
