import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateCompanyInput } from '../../domain/company/company.entity';
import { normalizeCompanyName } from '../../domain/company/company.entity';
import { CompanyRepository } from '../../domain/company/company.repository';
import { CreateContactInput } from '../../domain/contact/contact.entity';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { ProspectImportRepository } from '../../domain/prospect-import/prospect-import.repository';
import { ProspectImportRowRepository } from '../../domain/prospect-import/prospect-import-row.repository';
import {
  COMPANY_REPOSITORY,
  CONTACT_REPOSITORY,
  MAILBOX_REPOSITORY,
  PROSPECT_IMPORT_REPOSITORY,
  PROSPECT_IMPORT_ROW_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';

const BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Resolves/creates Company and Contact for the active Plantillas/Gestiones
 * flow, reusing the exact same tables and normalization rules the legacy
 * ConfirmProspectImportUseCase already uses — never a parallel identity
 * table. Runs once a Gestión's prospects have been accepted by the motor
 * (see StartSequenceExecutionUseCase), so Conversation rows created from
 * that point on can carry a real contactId/companyId instead of only a
 * denormalized snapshot.
 *
 * Idempotent and safe to re-run: only rows with `resolvedAt === null` are
 * considered, so a retry never re-resolves (or double-creates) anything.
 * A row without a valid email is left unresolved (§ "no crear Contact sin
 * correo válido en esta fase") — never a rejection of the whole batch.
 */
@Injectable()
export class ProspectIdentityResolver {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(PROSPECT_IMPORT_REPOSITORY) private readonly imports: ProspectImportRepository,
    @Inject(PROSPECT_IMPORT_ROW_REPOSITORY) private readonly rows: ProspectImportRowRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
  ) {}

  async resolveForExecution(organizationId: string, executionId: string, mailboxId: string): Promise<void> {
    const mailbox = await this.mailboxes.findById(mailboxId);
    // A ManagedClient is always resolved before a mailbox can be used to
    // start a Gestión (see StartSequenceExecutionUseCase's eligibility
    // check) — defensive only, never expected in practice.
    if (!mailbox || !mailbox.clientId) return;
    const clientId = mailbox.clientId;

    const importRecord = await this.imports.findByExecution(executionId);
    if (!importRecord) return;

    const allRows = await this.rows.findByImport(importRecord.id);
    const unresolved = allRows.filter(
      (row) => row.validationStatus === 'VALID' && row.resolvedAt === null && row.normalizedData,
    );
    if (unresolved.length === 0) return;

    await this.tx.run(async (ctx) => {
      // --- Companies: bulk-fetch existing, bulk-create the delta ---
      const distinctCompanyNames = [
        ...new Map(
          unresolved
            .map((row) => row.normalizedData!.companyName)
            .filter((name): name is string => !!name && name.trim().length > 0)
            .map((name) => [normalizeCompanyName(name), name] as const),
        ).entries(),
      ];
      const companyIdByNormalizedName = new Map<string, string>();
      for (const batch of chunk(distinctCompanyNames, BATCH_SIZE)) {
        const normalizedNames = batch.map(([normalized]) => normalized);
        const existing = await this.companies.findManyByNormalizedNames(organizationId, clientId, normalizedNames, ctx);
        for (const company of existing) companyIdByNormalizedName.set(company.normalizedName, company.id);
      }
      const newCompanyInputs: Array<CreateCompanyInput & { id: string }> = [];
      for (const [normalized, rawName] of distinctCompanyNames) {
        if (companyIdByNormalizedName.has(normalized)) continue;
        const id = randomUUID();
        companyIdByNormalizedName.set(normalized, id);
        newCompanyInputs.push({ id, organizationId, clientId, rawName });
      }
      for (const batch of chunk(newCompanyInputs, BATCH_SIZE)) {
        await this.companies.createMany(batch, ctx);
      }

      // --- Contacts: bulk-fetch existing, bulk-create the delta ---
      // Never create a Contact without a valid email — rows that fail this
      // simply stay unresolved (resolvedAt stays null) rather than blocking
      // the batch or being rejected.
      const rowsWithEmail = unresolved.filter((row) => isValidEmail(row.normalizedData!.email));
      const distinctEmails = [...new Set(rowsWithEmail.map((row) => row.normalizedData!.email.toLowerCase()))];
      const contactIdByEmail = new Map<string, string>();
      for (const batch of chunk(distinctEmails, BATCH_SIZE)) {
        const existing = await this.contacts.findManyByEmails(organizationId, clientId, batch, ctx);
        for (const contact of existing) contactIdByEmail.set(contact.email.toLowerCase(), contact.id);
      }
      const newContactInputs: Array<CreateContactInput & { id: string }> = [];
      const seenNewEmails = new Set<string>();
      for (const row of rowsWithEmail) {
        const email = row.normalizedData!.email.toLowerCase();
        if (contactIdByEmail.has(email) || seenNewEmails.has(email)) continue;
        seenNewEmails.add(email);
        const id = randomUUID();
        contactIdByEmail.set(email, id);
        const companyName = row.normalizedData!.companyName;
        const companyId = companyName ? companyIdByNormalizedName.get(normalizeCompanyName(companyName)) ?? null : null;
        newContactInputs.push({
          id,
          organizationId,
          clientId,
          companyId,
          email: row.normalizedData!.email,
          fullName: row.normalizedData!.contactName,
        });
      }
      for (const batch of chunk(newContactInputs, BATCH_SIZE)) {
        await this.contacts.createMany(batch, ctx);
      }

      // --- Stamp every resolvable row with its companyId/contactId ---
      const updates: Array<{ rowId: string; companyId: string | null; contactId: string }> = [];
      for (const row of rowsWithEmail) {
        const email = row.normalizedData!.email.toLowerCase();
        const contactId = contactIdByEmail.get(email);
        if (!contactId) continue;
        const companyName = row.normalizedData!.companyName;
        const companyId = companyName ? companyIdByNormalizedName.get(normalizeCompanyName(companyName)) ?? null : null;
        updates.push({ rowId: row.id, companyId, contactId });
      }
      // Never overwrites rawData/normalizedData (untouched — only companyId/
      // contactId/resolvedAt change) and never clears an already-resolved
      // row back to empty (only rows still at resolvedAt === null were
      // selected above).
      for (const batch of chunk(updates, BATCH_SIZE)) {
        await this.rows.bulkSetResolvedIdentity(batch, new Date(), ctx);
      }
    });
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
