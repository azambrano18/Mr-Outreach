import { CreateProspectImportInput, ProspectImport, UpdateProspectImportInput } from './prospect-import.entity';

export interface ProspectImportRepository {
  findById(id: string): Promise<ProspectImport | null>;
  findByExecution(executionId: string): Promise<ProspectImport | null>;
  create(input: CreateProspectImportInput): Promise<ProspectImport>;
  update(id: string, input: UpdateProspectImportInput): Promise<ProspectImport>;
  /** §10 — deletes this import; used when its owning DRAFT Gestión is deleted. */
  delete(id: string): Promise<void>;
}
