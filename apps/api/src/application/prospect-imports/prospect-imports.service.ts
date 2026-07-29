import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { NormalizedProspectData, ProspectExecutionState, ProspectImportRow } from '../../domain/prospect-import/prospect-import-row.entity';
import { ProspectImportRowRepository } from '../../domain/prospect-import/prospect-import-row.repository';
import { ProspectColumnMapping, ProspectImport } from '../../domain/prospect-import/prospect-import.entity';
import { ProspectImportRepository } from '../../domain/prospect-import/prospect-import.repository';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import {
  AUDIT_LOG_REPOSITORY,
  PROSPECT_IMPORT_REPOSITORY,
  PROSPECT_IMPORT_ROW_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
  SEQUENCE_TEMPLATE_VERSION_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { parseTabularFile } from '../../infrastructure/file-parsing/tabular-file-parser';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 3000;

export interface UploadProspectFileResult {
  importId: string;
  headers: string[];
  previewRows: Record<string, string>[];
  totalRowsDetected: number;
}

export interface SetMappingInput {
  email: string;
  contactName?: string | null;
  companyName?: string | null;
  customVariables: Record<string, string>;
}

export interface MappingRowPreview {
  rowNumber: number;
  raw: Record<string, string>;
  normalized: NormalizedProspectData | null;
  status: 'VALID' | 'INVALID' | 'DUPLICATE';
  errors: string[];
}

export interface MappingResultSummary {
  importId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  missingRequiredVariables: string[];
  rows: MappingRowPreview[];
}

/**
 * §15/§16 — a deliberately simpler pipeline than SequenceImportsService's:
 * no Company/Contact CRM materialization (Railway owns the actual send),
 * only normalized rows bundled straight into the SEQUENCE_EXECUTION_START
 * JSON. Raw parsed rows between "upload" and "confirm mapping" live only
 * in this process's memory (same narrow-window caveat SequenceImportsService
 * itself documents) — durable storage begins at setMapping(), which
 * persists every row via ProspectImportRowRepository.
 */
@Injectable()
export class ProspectImportsService {
  private readonly rawRowsByStorageKey = new Map<string, Record<string, string>[]>();

  constructor(
    @Inject(PROSPECT_IMPORT_REPOSITORY) private readonly imports: ProspectImportRepository,
    @Inject(PROSPECT_IMPORT_ROW_REPOSITORY) private readonly rows: ProspectImportRowRepository,
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly executions: SequenceExecutionRepository,
    @Inject(SEQUENCE_TEMPLATE_VERSION_REPOSITORY) private readonly templateVersions: SequenceTemplateVersionRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
  ) {}

  async uploadFile(
    organizationId: string,
    executiveId: string,
    executionId: string,
    file: { buffer: Buffer; originalName: string },
  ): Promise<UploadProspectFileResult> {
    const execution = await this.requireOwnedExecution(organizationId, executiveId, executionId);
    if (execution.status !== 'DRAFT') {
      throw new ConflictException('Esta gestión ya no admite cargar una nueva base de prospectos.');
    }

    const { rows, headers } = await parseTabularFile(file);
    if (rows.length === 0) {
      throw new BadRequestException('El archivo no contiene filas con datos.');
    }
    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(`El archivo supera el máximo de ${MAX_ROWS} filas permitidas.`);
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    // storageKey is immutable per ProspectImport row (§28) — a re-upload for
    // the same execution reuses the existing row's own key rather than
    // minting a new one, so this map entry is always addressable by it.
    let importRecord = await this.imports.findByExecution(executionId);
    const storageKey = importRecord?.storageKey ?? `prospect_${randomUUID()}`;

    if (importRecord) {
      importRecord = await this.imports.update(importRecord.id, {
        status: 'MAPPING_REQUIRED',
        columnMapping: null,
        totalRows: rows.length,
        validRows: 0,
        invalidRows: 0,
        duplicateRows: 0,
        excludedRows: 0,
      });
    } else {
      importRecord = await this.imports.create({
        organizationId,
        executionId,
        fileName: file.originalName,
        storageKey,
        checksum,
        createdBy: executiveId,
      });
      importRecord = await this.imports.update(importRecord.id, { status: 'MAPPING_REQUIRED', totalRows: rows.length });
    }
    this.rawRowsByStorageKey.set(storageKey, rows);

    await this.audit.record({
      organizationId,
      actorId: executiveId,
      action: 'prospect_import.upload',
      entityType: 'ProspectImport',
      entityId: importRecord.id,
      metadata: { executionId, fileName: file.originalName, totalRows: rows.length },
    });

    return {
      importId: importRecord.id,
      headers,
      previewRows: rows.slice(0, 10),
      totalRowsDetected: rows.length,
    };
  }

  async getRequiredVariables(organizationId: string, executiveId: string, executionId: string): Promise<string[]> {
    const execution = await this.requireOwnedExecution(organizationId, executiveId, executionId);
    const version = await this.templateVersions.findById(execution.templateVersionId);
    if (!version) throw new NotFoundException('Versión de plantilla no encontrada.');
    return version.variables.filter((v) => v.required).map((v) => v.key);
  }

  async setMapping(
    organizationId: string,
    executiveId: string,
    executionId: string,
    mapping: SetMappingInput,
  ): Promise<MappingResultSummary> {
    const execution = await this.requireOwnedExecution(organizationId, executiveId, executionId);
    const importRecord = await this.imports.findByExecution(executionId);
    if (!importRecord) throw new NotFoundException('No hay ningún archivo cargado para esta gestión.');

    const rawRows = this.rawRowsByStorageKey.get(importRecord.storageKey);
    if (!rawRows) {
      throw new ConflictException('El archivo cargado ya no está disponible en memoria; vuelve a subirlo.');
    }

    const version = await this.templateVersions.findById(execution.templateVersionId);
    if (!version) throw new NotFoundException('Versión de plantilla no encontrada.');
    const requiredKeys = version.variables.filter((v) => v.required).map((v) => v.key);
    const mappedCustomKeys = new Set(Object.keys(mapping.customVariables));
    const missingRequiredVariables = requiredKeys.filter((key) => !mappedCustomKeys.has(key) && key !== 'contact_name' && key !== 'company_name');

    if (!mapping.email) {
      throw new BadRequestException('Debes mapear una columna para el correo (email).');
    }

    const seenEmails = new Set<string>();
    const rowInputs: { rowNumber: number; raw: Record<string, string>; normalized: NormalizedProspectData | null; status: 'VALID' | 'INVALID' | 'DUPLICATE'; errors: string[] }[] = [];

    rawRows.forEach((raw, index) => {
      const rowNumber = index + 1;
      const email = (raw[mapping.email] ?? '').trim().toLowerCase();

      if (!email) {
        rowInputs.push({ rowNumber, raw, normalized: null, status: 'INVALID', errors: ['MISSING_EMAIL'] });
        return;
      }
      if (!EMAIL_REGEX.test(email)) {
        rowInputs.push({ rowNumber, raw, normalized: null, status: 'INVALID', errors: ['INVALID_EMAIL'] });
        return;
      }
      if (seenEmails.has(email)) {
        rowInputs.push({ rowNumber, raw, normalized: null, status: 'DUPLICATE', errors: ['DUPLICATE'] });
        return;
      }

      const variables: Record<string, string> = {};
      for (const [variableKey, columnHeader] of Object.entries(mapping.customVariables)) {
        variables[variableKey] = (raw[columnHeader] ?? '').trim();
      }
      const contactName = mapping.contactName ? (raw[mapping.contactName] ?? '').trim() || null : null;
      const companyName = mapping.companyName ? (raw[mapping.companyName] ?? '').trim() || null : null;

      const missingForRow = requiredKeys.filter((key) => {
        if (key === 'contact_name') return !contactName;
        if (key === 'company_name') return !companyName;
        return !variables[key];
      });
      if (missingForRow.length > 0) {
        rowInputs.push({ rowNumber, raw, normalized: null, status: 'INVALID', errors: missingForRow.map((k) => `MISSING_REQUIRED:${k}`) });
        return;
      }

      seenEmails.add(email);
      rowInputs.push({
        rowNumber,
        raw,
        normalized: { email, contactName, companyName, variables },
        status: 'VALID',
        errors: [],
      });
    });

    await this.rows.replaceForImport(
      importRecord.id,
      rowInputs.map((row) => ({
        organizationId,
        importId: importRecord.id,
        rowNumber: row.rowNumber,
        rawData: row.raw,
        normalizedData: row.normalized,
        validationStatus: row.status,
        validationErrors: row.errors,
      })),
    );

    const validRows = rowInputs.filter((r) => r.status === 'VALID').length;
    const invalidRows = rowInputs.filter((r) => r.status === 'INVALID').length;
    const duplicateRows = rowInputs.filter((r) => r.status === 'DUPLICATE').length;

    const columnMapping: ProspectColumnMapping = {
      email: mapping.email,
      contactName: mapping.contactName ?? null,
      companyName: mapping.companyName ?? null,
      customVariables: mapping.customVariables,
    };

    await this.imports.update(importRecord.id, {
      status: missingRequiredVariables.length > 0 ? 'MAPPING_REQUIRED' : 'READY',
      columnMapping,
      validRows,
      invalidRows,
      duplicateRows,
      excludedRows: 0,
    });

    await this.audit.record({
      organizationId,
      actorId: executiveId,
      action: 'prospect_import.mapping_saved',
      entityType: 'ProspectImport',
      entityId: importRecord.id,
      metadata: { validRows, invalidRows, duplicateRows },
    });

    return {
      importId: importRecord.id,
      totalRows: rowInputs.length,
      validRows,
      invalidRows,
      duplicateRows,
      missingRequiredVariables,
      rows: rowInputs.slice(0, 50),
    };
  }

  async getValidRows(executionId: string): Promise<ProspectImportRow[]> {
    const importRecord = await this.imports.findByExecution(executionId);
    if (!importRecord) return [];
    const allRows = await this.rows.findByImport(importRecord.id);
    return allRows.filter((r) => r.validationStatus === 'VALID');
  }

  async getImportForExecution(executionId: string): Promise<ProspectImport | null> {
    return this.imports.findByExecution(executionId);
  }

  /** §10 — deletes the temp import and its rows for a DRAFT Gestión being deleted; no-op if nothing was ever uploaded. */
  async deleteForExecution(executionId: string): Promise<void> {
    const importRecord = await this.imports.findByExecution(executionId);
    if (!importRecord) return;
    this.rawRowsByStorageKey.delete(importRecord.storageKey);
    await this.rows.deleteByImport(importRecord.id);
    await this.imports.delete(importRecord.id);
  }

  /** §2/§11 — stamps every VALID row with the server-assigned initial execution state right after the Gestión is accepted; never called for any other reason. */
  async markAccepted(executionId: string, initialState: ProspectExecutionState): Promise<void> {
    const importRecord = await this.imports.findByExecution(executionId);
    if (!importRecord) return;
    await this.rows.markValidRowsExecutionState(importRecord.id, initialState);
  }

  private async requireOwnedExecution(organizationId: string, executiveId: string, executionId: string) {
    const execution = await this.executions.findById(executionId);
    if (!execution || execution.organizationId !== organizationId || execution.executiveId !== executiveId) {
      throw new NotFoundException('Gestión no encontrada.');
    }
    return execution;
  }
}
