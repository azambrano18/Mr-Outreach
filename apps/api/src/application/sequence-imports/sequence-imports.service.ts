import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { normalizeCompanyName } from '../../domain/company/company.entity';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { IntegrationCommand } from '../../domain/integration/integration-command.entity';
import { IntegrationEvent } from '../../domain/integration/integration-event.entity';
import {
  ColumnMapping,
  ImportRejection,
  ImportScenario,
  SequenceImport,
} from '../../domain/sequence-import/sequence-import.entity';
import { SequenceImportRepository } from '../../domain/sequence-import/sequence-import.repository';
import {
  CreateSequenceImportRowInput,
  NormalizedImportRowData,
} from '../../domain/sequence-import-row/sequence-import-row.entity';
import { SequenceImportRowRepository } from '../../domain/sequence-import-row/sequence-import-row.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import {
  AUDIT_LOG_REPOSITORY,
  COMPANY_REPOSITORY,
  CONTACT_REPOSITORY,
  SEQUENCE_IMPORT_REPOSITORY,
  SEQUENCE_IMPORT_ROW_REPOSITORY,
  SEQUENCE_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { SimulatedMailEngineAdapter } from '../../infrastructure/mail-engine/simulated/simulated-mail-engine-adapter';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { IntegrationService } from '../integration/integration.service';
import { SchedulingService } from '../scheduling/scheduling.service';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * §17-22 — Upload → Preview → Map columns → Validate → Confirm → JSON →
 * simulated engine → accepted contacts auto-enroll into the sequence's
 * first PUBLISHED step. The command JSON itself never carries more than a
 * `storageReference` (§18) — the file's raw bytes are never persisted this
 * phase, only a logical reference.
 *
 * Fase 1 — every parsed row (accepted or rejected) is now persisted via
 * SequenceImportRowRepository as soon as setMappingAndValidate() classifies
 * it, so it survives a restart. The only thing still held in this
 * service's own process memory is `rawRowsByStorageKey`, and only for the
 * narrow upload→mapping gap: nothing has been "imported" yet at that
 * point (no mapping chosen, no validation run), so there is nothing a
 * restart would lose except the need to re-upload the same file — the
 * same "no real file storage yet" allowance already covers this.
 */
@Injectable()
export class SequenceImportsService {
  private readonly rawRowsByStorageKey = new Map<string, Record<string, string>[]>();

  constructor(
    @Inject(SEQUENCE_IMPORT_REPOSITORY) private readonly imports: SequenceImportRepository,
    @Inject(SEQUENCE_IMPORT_ROW_REPOSITORY) private readonly importRows: SequenceImportRowRepository,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly integration: IntegrationService,
    private readonly simulatedAdapter: SimulatedMailEngineAdapter,
    private readonly scheduling: SchedulingService,
  ) {}

  async list(organizationId: string, sequenceId: string): Promise<SequenceImport[]> {
    return this.imports.findBySequence(organizationId, sequenceId);
  }

  async getById(organizationId: string, importId: string): Promise<SequenceImport> {
    return this.getOwnedImport(organizationId, importId);
  }

  async upload(
    organizationId: string,
    sequenceId: string,
    actorId: string,
    file: { buffer: Buffer; originalName: string },
  ): Promise<{ import: SequenceImport; headers: string[]; previewRows: Record<string, string>[] }> {
    const sequence = await this.sequences.findById(sequenceId);
    if (!sequence || sequence.organizationId !== organizationId) {
      throw new NotFoundException('Sequence not found.');
    }
    if (!sequence.mailboxId || !sequence.clientId) {
      throw new ConflictException('La secuencia necesita una cuenta remitente antes de importar contactos.');
    }

    const { rows, headers } = await this.parseFile(file);

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = `import_${randomUUID()}`;
    this.rawRowsByStorageKey.set(storageKey, rows);

    const created = await this.imports.create({
      organizationId,
      clientId: sequence.clientId,
      sequenceId: sequence.id,
      executiveId: sequence.executiveId,
      mailboxId: sequence.mailboxId,
      fileName: file.originalName,
      storageKey,
      checksum,
      totalRows: rows.length,
      createdBy: actorId,
    });
    const updated = await this.imports.update(created.id, { status: 'MAPPING_REQUIRED' });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence_import.upload',
      entityType: 'SequenceImport',
      entityId: created.id,
      metadata: { fileName: file.originalName, totalRows: rows.length },
    });

    return { import: updated, headers, previewRows: rows.slice(0, 10) };
  }

  /** §17-19 — maps columns and validates in one pass; the file is small enough this needs no separate async step. */
  async setMappingAndValidate(
    organizationId: string,
    importId: string,
    mapping: ColumnMapping,
    actorId: string,
  ): Promise<SequenceImport> {
    const importRow = await this.getOwnedImport(organizationId, importId);
    const rawRows = this.rawRowsByStorageKey.get(importRow.storageKey);
    if (!rawRows) {
      throw new ConflictException('Los datos de la importación ya no están disponibles; vuelve a subir el archivo.');
    }

    const seenEmails = new Set<string>();
    const rejections: ImportRejection[] = [];
    let acceptedCount = 0;
    const companyNormalizedNames = new Set<string>();
    const rowsToPersist: CreateSequenceImportRowInput[] = [];

    const pushRejected = (
      rowNumber: number,
      raw: Record<string, string>,
      email: string | null,
      reason: ImportRejection['reason'],
      detail: string,
    ): void => {
      rejections.push({ row: rowNumber, reason, detail });
      rowsToPersist.push({
        organizationId,
        importId: importRow.id,
        rowNumber,
        rawData: raw,
        email,
        validationStatus: reason === 'DUPLICATE' ? 'DUPLICATE' : reason.startsWith('EXCLUDED') ? 'EXCLUDED' : 'INVALID',
        isDuplicate: reason === 'DUPLICATE',
        rejectionReason: detail,
      });
    };

    for (let i = 0; i < rawRows.length; i += 1) {
      const row = rawRows[i];
      const rowNumber = i + 1;
      const email = (mapping.email ? row[mapping.email] : undefined)?.trim().toLowerCase();

      if (!email) {
        pushRejected(rowNumber, row, null, 'MISSING_REQUIRED_FIELD', 'Falta el correo electrónico.');
        continue;
      }
      if (!EMAIL_REGEX.test(email)) {
        pushRejected(rowNumber, row, email, 'INVALID_EMAIL', `Correo inválido: ${email}`);
        continue;
      }
      if (seenEmails.has(email)) {
        pushRejected(rowNumber, row, email, 'DUPLICATE', `Correo duplicado en el archivo: ${email}`);
        continue;
      }

      const existingContact = await this.contacts.findByEmail(organizationId, importRow.clientId, email);
      if (existingContact?.suppressed) {
        pushRejected(rowNumber, row, email, 'EXCLUDED_CONTACT', `Contacto en exclusión global: ${email}`);
        continue;
      }

      const companyRawName = mapping.company ? row[mapping.company]?.trim() : undefined;
      if (companyRawName) {
        const normalized = normalizeCompanyName(companyRawName);
        const existingCompany = await this.companies.findByNormalizedName(
          organizationId,
          importRow.clientId,
          normalized,
        );
        if (existingCompany?.suppressed) {
          pushRejected(
            rowNumber,
            row,
            email,
            'EXCLUDED_COMPANY',
            `Empresa en exclusión global: ${companyRawName}`,
          );
          continue;
        }
        companyNormalizedNames.add(normalized);
      }

      seenEmails.add(email);
      acceptedCount += 1;
      const normalizedData: NormalizedImportRowData = {
        email,
        firstName: (mapping.firstName ? row[mapping.firstName] : undefined)?.trim() || null,
        lastName: (mapping.lastName ? row[mapping.lastName] : undefined)?.trim() || null,
        fullName: (mapping.fullName ? row[mapping.fullName] : undefined)?.trim() || null,
        companyRawName: companyRawName || null,
        jobTitle: (mapping.jobTitle ? row[mapping.jobTitle] : undefined)?.trim() || null,
        phone: (mapping.phone ? row[mapping.phone] : undefined)?.trim() || null,
        city: (mapping.city ? row[mapping.city] : undefined)?.trim() || null,
        country: (mapping.country ? row[mapping.country] : undefined)?.trim() || null,
        website: (mapping.website ? row[mapping.website] : undefined)?.trim() || null,
        linkedin: (mapping.linkedin ? row[mapping.linkedin] : undefined)?.trim() || null,
      };
      rowsToPersist.push({
        organizationId,
        importId: importRow.id,
        rowNumber,
        rawData: row,
        normalizedData,
        companyRawName: companyRawName || null,
        email,
        validationStatus: 'VALID',
      });
    }

    await this.importRows.replaceForImport(organizationId, importRow.id, rowsToPersist);

    const invalidRows = rejections.filter(
      (r) => r.reason === 'INVALID_EMAIL' || r.reason === 'MISSING_REQUIRED_FIELD',
    ).length;
    const duplicateRows = rejections.filter((r) => r.reason === 'DUPLICATE').length;
    const excludedRows = rejections.filter(
      (r) => r.reason === 'EXCLUDED_CONTACT' || r.reason === 'EXCLUDED_COMPANY',
    ).length;

    const updated = await this.imports.update(importRow.id, {
      status: 'READY',
      columnMapping: mapping,
      validRows: acceptedCount,
      invalidRows,
      duplicateRows,
      excludedRows,
      companiesDetected: companyNormalizedNames.size,
      contactsAccepted: acceptedCount,
      contactsRejected: rejections.length,
      rejections,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence_import.validate',
      entityType: 'SequenceImport',
      entityId: importRow.id,
      metadata: { validRows: acceptedCount, rejected: rejections.length },
    });

    return updated;
  }

  /** §18 — generates SEQUENCE_IMPORT_REQUESTED; the rows themselves never leave this process, only the storageReference does. */
  async confirm(
    organizationId: string,
    importId: string,
    actorId: string,
    idempotencyKey?: string,
  ): Promise<{ import: SequenceImport; command: IntegrationCommand; duplicate: boolean }> {
    const importRow = await this.getOwnedImport(organizationId, importId);
    if (importRow.status !== 'READY') {
      throw new ConflictException('La importación debe estar validada (READY) antes de confirmarla.');
    }

    const payload = {
      importId: importRow.id,
      clientId: importRow.clientId,
      sequenceId: importRow.sequenceId,
      executiveId: importRow.executiveId,
      mailboxId: importRow.mailboxId,
      storageReference: {
        storageKey: importRow.storageKey,
        checksum: importRow.checksum,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      columnMapping: importRow.columnMapping,
      executionPolicy: { autoEnrollFirstStep: true },
    };

    const { command, duplicate } = await this.integration.submit(
      {
        organizationId,
        commandType: 'SEQUENCE_IMPORT_REQUESTED',
        aggregateType: 'SEQUENCE_IMPORT',
        aggregateId: importRow.id,
        payload,
        requestedBy: actorId,
        idempotencyKey: idempotencyKey ?? `sequence-import:${importRow.id}:${randomUUID()}`,
      },
      actorId,
    );

    if (!duplicate) {
      await this.imports.update(importRow.id, { status: 'SUBMITTED', commandId: command.commandId });
    }

    return { import: await this.getOwnedImport(organizationId, importId), command, duplicate };
  }

  setScenario(commandId: string, scenario: ImportScenario): void {
    this.simulatedAdapter.setImportScenario(commandId, scenario);
  }

  async advance(
    organizationId: string,
    importId: string,
    mode: 'ONE' | 'ALL',
    actorId: string,
  ): Promise<{ import: SequenceImport; events: IntegrationEvent[] }> {
    const importRow = await this.getOwnedImport(organizationId, importId);
    if (!importRow.commandId) {
      throw new NotFoundException('Esta importación no tiene un comando activo.');
    }

    const events = await this.integration.advance(organizationId, importRow.commandId, mode, actorId);
    for (const event of events) {
      await this.applyEvent(organizationId, importRow, event);
    }

    return { import: await this.getOwnedImport(organizationId, importId), events };
  }

  private async applyEvent(
    organizationId: string,
    importRow: SequenceImport,
    event: IntegrationEvent,
  ): Promise<void> {
    switch (event.eventType) {
      case 'SEQUENCE_IMPORT_ACCEPTED':
        await this.imports.update(importRow.id, { status: 'ACCEPTED' });
        break;
      case 'SEQUENCE_IMPORT_PROCESSING':
        await this.imports.update(importRow.id, { status: 'PROCESSING' });
        break;
      case 'SEQUENCE_IMPORT_FAILED':
        await this.imports.update(importRow.id, {
          status: 'FAILED',
          lastError: 'El motor simulado reportó un fallo al procesar la importación.',
        });
        break;
      case 'SEQUENCE_IMPORT_COMPLETED':
        await this.materialize(organizationId, importRow, false);
        break;
      case 'SEQUENCE_IMPORT_PARTIALLY_COMPLETED':
        await this.materialize(organizationId, importRow, true);
        break;
      default:
        break;
    }
  }

  /** §21 — creates Company/Contact rows for every accepted row, then auto-enrolls them into the first PUBLISHED step. */
  private async materialize(organizationId: string, importRow: SequenceImport, partial: boolean): Promise<void> {
    const acceptedRows = await this.importRows.findByImport(organizationId, importRow.id, {
      validationStatus: 'VALID',
    });
    const sequence = await this.sequences.findById(importRow.sequenceId);
    if (!sequence) {
      await this.imports.update(importRow.id, { status: 'FAILED', lastError: 'Secuencia no encontrada.' });
      return;
    }

    const enrolledRefs: Array<{ contactId: string; companyId: string | null }> = [];
    for (const importRowEntry of acceptedRows) {
      const row = importRowEntry.normalizedData;
      if (!row) continue;

      let companyId: string | null = null;
      if (row.companyRawName) {
        const normalized = normalizeCompanyName(row.companyRawName);
        let company = await this.companies.findByNormalizedName(organizationId, importRow.clientId, normalized);
        if (!company) {
          company = await this.companies.create({
            organizationId,
            clientId: importRow.clientId,
            rawName: row.companyRawName,
          });
        }
        companyId = company.id;
      }

      let contact = await this.contacts.findByEmail(organizationId, importRow.clientId, row.email);
      if (!contact) {
        contact = await this.contacts.create({
          organizationId,
          clientId: importRow.clientId,
          companyId,
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          fullName: row.fullName,
          jobTitle: row.jobTitle,
          phone: row.phone,
          city: row.city,
          country: row.country,
          website: row.website,
          linkedin: row.linkedin,
        });
      }
      await this.importRows.update(importRowEntry.id, { contactId: contact.id });
      enrolledRefs.push({ contactId: contact.id, companyId: contact.companyId });
    }

    const { firstStep } = await this.scheduling.enrollAcceptedContacts(
      organizationId,
      sequence,
      enrolledRefs,
      importRow.id,
    );

    if (!firstStep) {
      await this.imports.update(importRow.id, {
        status: 'FAILED',
        lastError: 'La secuencia no tiene ningún step publicado; la importación no puede completarse operativamente.',
      });
      return;
    }

    await this.imports.update(importRow.id, { status: partial ? 'PARTIALLY_COMPLETED' : 'COMPLETED' });
  }

  /**
   * §7 — the wizard only ever offers `.xlsx`; `.csv` is kept working too since the original
   * generic (pre-wizard) sequence-import flow — and its e2e coverage — already relies on it.
   * Anything else is rejected outright rather than silently mis-parsed.
   */
  private async parseFile(file: {
    buffer: Buffer;
    originalName: string;
  }): Promise<{ rows: Record<string, string>[]; headers: string[] }> {
    const lowerName = file.originalName.toLowerCase();

    if (lowerName.endsWith('.xlsx')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        throw new BadRequestException('El archivo .xlsx no contiene ninguna hoja.');
      }

      const headers: string[] = [];
      worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
        headers[colNumber - 1] = String(cell.text ?? '').trim();
      });

      const rows: Record<string, string>[] = [];
      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        const record: Record<string, string> = {};
        let hasValue = false;
        headers.forEach((header, index) => {
          if (!header) return;
          const value = String(row.getCell(index + 1).text ?? '').trim();
          record[header] = value;
          if (value) hasValue = true;
        });
        if (hasValue) rows.push(record);
      }
      return { rows, headers };
    }

    if (lowerName.endsWith('.csv')) {
      const parsed = Papa.parse<Record<string, string>>(file.buffer.toString('utf-8'), {
        header: true,
        skipEmptyLines: true,
      });
      return { rows: parsed.data, headers: parsed.meta.fields ?? [] };
    }

    throw new BadRequestException('Formato de archivo no soportado — solo se permiten .xlsx o .csv.');
  }

  private async getOwnedImport(organizationId: string, importId: string): Promise<SequenceImport> {
    const importRow = await this.imports.findById(importId);
    if (!importRow || importRow.organizationId !== organizationId) {
      throw new NotFoundException('Import not found.');
    }
    return importRow;
  }
}
