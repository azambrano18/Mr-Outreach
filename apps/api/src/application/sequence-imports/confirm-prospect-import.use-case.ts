import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { normalizeVariableKey } from '@outreach/validation';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { normalizeCompanyName } from '../../domain/company/company.entity';
import { CompanyRepository } from '../../domain/company/company.repository';
import { CreateContactInput } from '../../domain/contact/contact.entity';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { CreateSequenceContactInput } from '../../domain/sequence-contact/sequence-contact.entity';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { NormalizedImportRowData, SequenceImportRow } from '../../domain/sequence-import-row/sequence-import-row.entity';
import { SequenceImportRowRepository } from '../../domain/sequence-import-row/sequence-import-row.repository';
import { SequenceImportRepository } from '../../domain/sequence-import/sequence-import.repository';
import {
  AUDIT_LOG_REPOSITORY,
  COMPANY_REPOSITORY,
  CONTACT_REPOSITORY,
  MANAGED_CLIENT_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  SEQUENCE_IMPORT_REPOSITORY,
  SEQUENCE_IMPORT_ROW_REPOSITORY,
  SEQUENCE_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { isUniqueConstraintViolation } from '../../infrastructure/persistence/prisma/prisma-transaction-manager';
import { ClientEligibilityService } from '../clients/client-eligibility.service';
import { IDEMPOTENCY_SCOPE, IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { hashLogicalPayload } from '../idempotency/payload-canonicalizer';
import { IntegrationService } from '../integration/integration.service';

export const MAX_IMPORT_ROWS = 3000;
const MATERIALIZATION_BATCH_SIZE = 500;
const TRANSACTION_TIMEOUT_MS = 30_000;

/** Fase 2, Caso B — never let a custom variable silently overwrite one of these. */
const RESERVED_CUSTOM_FIELD_KEYS = new Set(['empresa', 'nombre_contacto', 'correo_contacto']);

export interface ConfirmProspectImportInput {
  organizationId: string;
  importId: string;
  sequenceId: string;
  actorId: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface ConfirmProspectImportResult {
  importId: string;
  sequenceId: string;
  status: string;
  totalProcessed: number;
  companiesCreated: number;
  contactsCreated: number;
  contactsReused: number;
  contactsEnrolled: number;
  commandId: string;
  commandStatus: string;
  correlationId: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/**
 * Fase 2, Caso B — replaces the deferred `SUBMITTED → advance → materialize`
 * pattern with one synchronous, atomic confirmation: companies, contacts,
 * custom variables, sequence-contact enrollment, row results, counters,
 * final status, audit and the idempotent command all commit together in a
 * single PostgreSQL transaction (max ~30s), or nothing does. Bulk
 * operations throughout (never one query per row) — see each repository's
 * `findMany*`/`createMany`/`bulkSetContactAndNormalizedData`.
 */
@Injectable()
export class ConfirmProspectImportUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(SEQUENCE_IMPORT_REPOSITORY) private readonly imports: SequenceImportRepository,
    @Inject(SEQUENCE_IMPORT_ROW_REPOSITORY) private readonly importRows: SequenceImportRowRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(SEQUENCE_STEP_REPOSITORY) private readonly steps: SequenceStepRepository,
    @Inject(MANAGED_CLIENT_REPOSITORY) private readonly managedClients: ManagedClientRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly eligibility: ClientEligibilityService,
    private readonly idempotency: IdempotentOperationService,
    private readonly integration: IntegrationService,
  ) {}

  async execute(
    input: ConfirmProspectImportInput,
  ): Promise<{ result: ConfirmProspectImportResult; httpStatus: number }> {
    const importRow = await this.imports.findById(input.importId);
    if (!importRow || importRow.organizationId !== input.organizationId) {
      throw new NotFoundException('Importación no encontrada.');
    }
    if (importRow.sequenceId !== input.sequenceId) {
      throw new NotFoundException('La importación no corresponde a esta secuencia.');
    }

    // §"Reintento con mismo payload... debe devolverse el resultado
    // persistido de la primera operación" — checked BEFORE any
    // state-dependent validation (status/CRM/steps), since a legitimate
    // retry arrives *after* the import has already moved past READY.
    // Only the fields stable across the whole confirm lifecycle
    // (id/sequenceId/checksum) feed the hash — never the current status.
    const payloadHash = hashLogicalPayload({
      importId: importRow.id,
      sequenceId: importRow.sequenceId,
      checksum: importRow.checksum,
    });

    const existing = await this.idempotency.checkExisting(
      input.organizationId,
      IDEMPOTENCY_SCOPE.IMPORT_CONFIRM,
      input.idempotencyKey,
      payloadHash,
    );
    if (existing) {
      return {
        result: existing.resultSnapshot as unknown as ConfirmProspectImportResult,
        httpStatus: existing.httpStatusCode ?? 201,
      };
    }

    if (importRow.status !== 'READY') {
      throw new ConflictException('La importación debe estar validada (READY) antes de confirmarla.');
    }

    const validRows = await this.importRows.findByImport(input.organizationId, input.importId, {
      validationStatus: 'VALID',
    });
    if (validRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `Esta importación tiene ${validRows.length} filas válidas, más que el máximo permitido (${MAX_IMPORT_ROWS}).`,
      );
    }

    const managedClient = await this.managedClients.findById(importRow.clientId);
    if (!managedClient) {
      throw new NotFoundException('Cliente no encontrado.');
    }
    await this.eligibility.assertEligibleForPublish(managedClient);

    const sequence = await this.sequences.findById(input.sequenceId);
    if (!sequence || sequence.organizationId !== input.organizationId) {
      throw new NotFoundException('Secuencia no encontrada.');
    }
    if (!sequence.mailboxId) {
      throw new ConflictException('La secuencia todavía no tiene una cuenta de envío asignada.');
    }
    const allSteps = (await this.steps.findBySequence(sequence.id)).sort((a, b) => a.position - b.position);
    const firstPublishedStep = allSteps.find((step) => step.status === 'PUBLISHED') ?? null;
    if (!firstPublishedStep) {
      throw new ConflictException('La secuencia no tiene ningún step publicado todavía.');
    }

    try {
      const { result, command } = await this.tx.run(
        async (ctx) => {
          const claimedCount = await this.imports.conditionalUpdateStatus(importRow.id, 'READY', 'PROCESSING', ctx);
          if (claimedCount !== 1) {
            throw new ConflictException('Esta importación ya fue confirmada o está siendo confirmada.');
          }

          const rows = await this.importRows.findByImport(
            input.organizationId,
            input.importId,
            { validationStatus: 'VALID' },
            ctx,
          );

          const customFieldMapping = importRow.columnMapping?.customFields ?? {};

          // --- Companies: bulk-fetch existing, bulk-create the delta ---
          const distinctCompanyRawNames = [
            ...new Map(
              rows
                .map((row) => row.companyRawName ?? row.normalizedData?.companyRawName ?? null)
                .filter((name): name is string => !!name && name.trim().length > 0)
                .map((name) => [normalizeCompanyName(name), name] as const),
            ).entries(),
          ];
          const distinctNormalizedCompanyNames = distinctCompanyRawNames.map(([normalized]) => normalized);
          const existingCompanies: Array<{ id: string; normalizedName: string }> = [];
          for (const batch of chunk(distinctNormalizedCompanyNames, MATERIALIZATION_BATCH_SIZE)) {
            existingCompanies.push(...(await this.companies.findManyByNormalizedNames(
              input.organizationId,
              managedClient.id,
              batch,
              ctx,
            )));
          }
          const companyIdByNormalizedName = new Map(existingCompanies.map((c) => [c.normalizedName, c.id]));
          const newCompanyInputs = distinctCompanyRawNames
            .filter(([normalized]) => !companyIdByNormalizedName.has(normalized))
            .map(([normalized, rawName]) => {
              const id = randomUUID();
              companyIdByNormalizedName.set(normalized, id);
              return { id, organizationId: input.organizationId, clientId: managedClient.id, rawName };
            });
          for (const batch of chunk(newCompanyInputs, MATERIALIZATION_BATCH_SIZE)) {
            await this.companies.createMany(batch, ctx);
          }

          // --- Contacts: bulk-fetch existing, bulk-create the delta (with custom fields) ---
          const distinctEmails = [
            ...new Set(rows.map((row) => (row.email ?? row.normalizedData?.email ?? '').toLowerCase()).filter(Boolean)),
          ];
          const existingContacts: Array<{ id: string; email: string }> = [];
          for (const batch of chunk(distinctEmails, MATERIALIZATION_BATCH_SIZE)) {
            existingContacts.push(
              ...(await this.contacts.findManyByEmails(input.organizationId, managedClient.id, batch, ctx)),
            );
          }
          const contactIdByEmail = new Map(existingContacts.map((c) => [c.email.toLowerCase(), c.id]));

          const rowPlans = rows.map((row) => this.planRow(row, customFieldMapping, companyIdByNormalizedName));

          const newContactInputs: Array<CreateContactInput & { id: string }> = [];
          const seenNewEmails = new Set<string>();
          for (const plan of rowPlans) {
            if (!plan.email || contactIdByEmail.has(plan.email) || seenNewEmails.has(plan.email)) continue;
            seenNewEmails.add(plan.email);
            const id = randomUUID();
            contactIdByEmail.set(plan.email, id);
            newContactInputs.push({
              id,
              organizationId: input.organizationId,
              clientId: managedClient.id,
              companyId: plan.companyId,
              email: plan.email,
              firstName: plan.normalizedData.firstName,
              lastName: plan.normalizedData.lastName,
              fullName: plan.normalizedData.fullName,
              jobTitle: plan.normalizedData.jobTitle,
              phone: plan.normalizedData.phone,
              city: plan.normalizedData.city,
              country: plan.normalizedData.country,
              website: plan.normalizedData.website,
              linkedin: plan.normalizedData.linkedin,
              customFields: plan.normalizedData.customFields ?? {},
            });
          }
          for (const batch of chunk(newContactInputs, MATERIALIZATION_BATCH_SIZE)) {
            await this.contacts.createMany(batch, ctx);
          }

          // --- Sequence enrollment: bulk-check already-enrolled, bulk-create the delta ---
          const alreadyEnrolled = await this.sequenceContacts.findBySequence(input.organizationId, sequence.id, {}, ctx);
          const alreadyEnrolledContactIds = new Set(alreadyEnrolled.map((sc) => sc.contactId));

          const newEnrollmentInputs: Array<CreateSequenceContactInput & { id: string }> = [];
          const seenEnrollContactIds = new Set<string>();
          const rowResults: Array<{ rowId: string; contactId: string; normalizedData: NormalizedImportRowData }> = [];
          for (const plan of rowPlans) {
            const contactId = plan.email ? contactIdByEmail.get(plan.email) : undefined;
            if (!contactId) continue;
            rowResults.push({ rowId: plan.rowId, contactId, normalizedData: plan.normalizedData });
            if (alreadyEnrolledContactIds.has(contactId) || seenEnrollContactIds.has(contactId)) continue;
            seenEnrollContactIds.add(contactId);
            newEnrollmentInputs.push({
              id: randomUUID(),
              organizationId: input.organizationId,
              clientId: managedClient.id,
              sequenceId: sequence.id,
              sequenceVersion: sequence.sequenceVersion,
              contactId,
              companyId: plan.companyId,
              sourceImportId: importRow.id,
              assignedMailboxId: sequence.mailboxId as string,
              assignedExecutiveId: sequence.executiveId,
              currentStepId: firstPublishedStep.id,
              currentStepPosition: firstPublishedStep.position,
            });
          }
          for (const batch of chunk(newEnrollmentInputs, MATERIALIZATION_BATCH_SIZE)) {
            await this.sequenceContacts.createMany(batch, ctx);
          }

          // --- Row results: one statement for the whole batch, never per row ---
          for (const batch of chunk(rowResults, MATERIALIZATION_BATCH_SIZE)) {
            await this.importRows.bulkSetContactAndNormalizedData(batch, ctx);
          }

          const correlationId = input.correlationId ?? `corr_${importRow.id}`;
          const commandId = `cmd_${randomUUID()}`;

          const updatedImport = await this.imports.update(
            importRow.id,
            {
              status: 'COMPLETED',
              companiesDetected: companyIdByNormalizedName.size,
              contactsAccepted: rowResults.length,
              commandId,
            },
            ctx,
          );

          await this.auditLogs.record(
            {
              organizationId: input.organizationId,
              actorId: input.actorId,
              action: 'sequence_import.confirm',
              entityType: 'SequenceImport',
              entityId: importRow.id,
              metadata: {
                correlationId: input.correlationId ?? null,
                idempotencyKey: input.idempotencyKey,
                sequenceId: sequence.id,
                totalProcessed: rowResults.length,
                companiesCreated: newCompanyInputs.length,
                contactsCreated: newContactInputs.length,
                contactsEnrolled: newEnrollmentInputs.length,
              },
            },
            ctx,
          );

          const commandPayload = {
            importId: importRow.id,
            clientId: managedClient.id,
            sequenceId: importRow.sequenceId,
            executiveId: importRow.executiveId,
            mailboxId: importRow.mailboxId,
            storageReference: { storageKey: importRow.storageKey, checksum: importRow.checksum },
            columnMapping: importRow.columnMapping,
          };

          const result: ConfirmProspectImportResult = {
            importId: updatedImport.id,
            sequenceId: sequence.id,
            status: updatedImport.status,
            totalProcessed: rowResults.length,
            companiesCreated: newCompanyInputs.length,
            contactsCreated: newContactInputs.length,
            contactsReused: rowResults.length - newContactInputs.length,
            contactsEnrolled: newEnrollmentInputs.length,
            commandId,
            commandStatus: 'REQUESTED',
            correlationId,
          };

          const command = await this.idempotency.claim(
            ctx,
            {
              organizationId: input.organizationId,
              scope: IDEMPOTENCY_SCOPE.IMPORT_CONFIRM,
              rawIdempotencyKey: input.idempotencyKey,
              payloadHash,
              commandType: 'SEQUENCE_IMPORT_REQUESTED',
              aggregateType: 'SEQUENCE_IMPORT',
              aggregateId: importRow.id,
              correlationId,
              requestedBy: input.actorId,
              commandPayload,
              commandId,
            },
            result as unknown as Record<string, unknown>,
            201,
          );

          return { result, command };
        },
        { timeoutMs: TRANSACTION_TIMEOUT_MS },
      );

      try {
        const dispatched = await this.integration.dispatchExistingCommand(command, input.actorId);
        result.commandStatus = dispatched.status;
        await this.idempotency.refreshResultSnapshot(command.id, result as unknown as Record<string, unknown>);
      } catch (dispatchError) {
        console.error(
          JSON.stringify({
            event: 'confirm_prospect_import.dispatch_failed',
            correlationId: result.correlationId,
            commandId: result.commandId,
            organizationId: input.organizationId,
            message: dispatchError instanceof Error ? dispatchError.message : 'unknown error',
          }),
        );
      }

      return { result, httpStatus: 201 };
    } catch (error) {
      if (error instanceof ConflictException || isUniqueConstraintViolation(error)) {
        const raced = await this.idempotency.checkExisting(
          input.organizationId,
          IDEMPOTENCY_SCOPE.IMPORT_CONFIRM,
          input.idempotencyKey,
          payloadHash,
        );
        if (raced) {
          return {
            result: raced.resultSnapshot as unknown as ConfirmProspectImportResult,
            httpStatus: raced.httpStatusCode ?? 201,
          };
        }
      }
      throw error;
    }
  }

  /** Extracts + normalizes one row's final data, including reserved-name-safe custom fields. Pure, no I/O. */
  private planRow(
    row: SequenceImportRow,
    customFieldMapping: Record<string, string>,
    companyIdByNormalizedName: Map<string, string>,
  ): { rowId: string; email: string | null; companyId: string | null; normalizedData: NormalizedImportRowData } {
    const base: NormalizedImportRowData = row.normalizedData ?? {
      email: row.email ?? '',
      firstName: null,
      lastName: null,
      fullName: null,
      companyRawName: row.companyRawName,
      jobTitle: null,
      phone: null,
      city: null,
      country: null,
      website: null,
      linkedin: null,
    };

    const customFields: Record<string, string> = {};
    for (const [variableName, columnName] of Object.entries(customFieldMapping)) {
      const normalizedKey = normalizeVariableKey(variableName);
      if (RESERVED_CUSTOM_FIELD_KEYS.has(normalizedKey)) continue; // never overwrite a base variable
      const rawValue = row.rawData[columnName];
      if (rawValue === undefined || rawValue === null) continue; // never encode "undefined"/"null" as a string
      const trimmed = String(rawValue).trim();
      if (trimmed.length === 0) continue;
      customFields[normalizedKey] = trimmed;
    }

    const email = (row.email ?? base.email ?? '').toLowerCase() || null;
    const companyRawName = row.companyRawName ?? base.companyRawName ?? null;
    const companyId = companyRawName ? (companyIdByNormalizedName.get(normalizeCompanyName(companyRawName)) ?? null) : null;

    return {
      rowId: row.id,
      email,
      companyId,
      normalizedData: { ...base, customFields },
    };
  }
}
