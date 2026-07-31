import { CompanyRepository } from '../../domain/company/company.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { ProspectImportRepository } from '../../domain/prospect-import/prospect-import.repository';
import { ProspectImportRowRepository } from '../../domain/prospect-import/prospect-import-row.repository';
import { ProspectIdentityResolver } from './prospect-identity-resolver.service';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('ProspectIdentityResolver', () => {
  let mailboxes: jest.Mocked<Pick<MailboxRepository, 'findById'>>;
  let imports: jest.Mocked<Pick<ProspectImportRepository, 'findByExecution'>>;
  let rows: jest.Mocked<Pick<ProspectImportRowRepository, 'findByImport' | 'bulkSetResolvedIdentity'>>;
  let companies: jest.Mocked<Pick<CompanyRepository, 'findManyByNormalizedNames' | 'createMany'>>;
  let contacts: jest.Mocked<Pick<ContactRepository, 'findManyByEmails' | 'createMany'>>;
  let resolver: ProspectIdentityResolver;

  const orgId = 'org_1';
  const clientId = 'client_1';
  const executionId = 'exec_1';
  const mailboxId = 'mailbox_1';

  function row(overrides: Partial<{ id: string; validationStatus: 'VALID' | 'INVALID'; resolvedAt: Date | null; email: string; contactName: string | null; companyName: string | null }> = {}) {
    const o = { id: 'row_1', validationStatus: 'VALID' as const, resolvedAt: null, email: 'persona@empresa.cl', contactName: 'Persona', companyName: 'Empresa Uno', ...overrides };
    return {
      id: o.id,
      organizationId: orgId,
      importId: 'import_1',
      rowNumber: 1,
      rawData: {},
      normalizedData: { email: o.email, contactName: o.contactName, companyName: o.companyName, variables: {} },
      validationStatus: o.validationStatus,
      validationErrors: [],
      executionState: null,
      companyId: null,
      contactId: null,
      resolvedAt: o.resolvedAt,
      createdAt: new Date(),
    };
  }

  beforeEach(() => {
    mailboxes = { findById: jest.fn().mockResolvedValue({ id: mailboxId, clientId }) };
    imports = { findByExecution: jest.fn().mockResolvedValue({ id: 'import_1' }) };
    rows = {
      findByImport: jest.fn().mockResolvedValue([row()]),
      bulkSetResolvedIdentity: jest.fn().mockResolvedValue(undefined),
    };
    companies = {
      findManyByNormalizedNames: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue([]),
    };
    contacts = {
      findManyByEmails: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue([]),
    };

    resolver = new ProspectIdentityResolver(
      new FakeTransactionManager(),
      mailboxes as unknown as MailboxRepository,
      imports as unknown as ProspectImportRepository,
      rows as unknown as ProspectImportRowRepository,
      companies as unknown as CompanyRepository,
      contacts as unknown as ContactRepository,
    );
  });

  it('creates a new Company and Contact for a row with no existing match, and stamps the row resolved', async () => {
    await resolver.resolveForExecution(orgId, executionId, mailboxId);

    expect(companies.createMany).toHaveBeenCalledWith(
      [expect.objectContaining({ organizationId: orgId, clientId, rawName: 'Empresa Uno' })],
      expect.anything(),
    );
    expect(contacts.createMany).toHaveBeenCalledWith(
      [expect.objectContaining({ organizationId: orgId, clientId, email: 'persona@empresa.cl', fullName: 'Persona' })],
      expect.anything(),
    );
    expect(rows.bulkSetResolvedIdentity).toHaveBeenCalledWith(
      [expect.objectContaining({ rowId: 'row_1', contactId: expect.any(String) })],
      expect.any(Date),
      expect.anything(),
    );
  });

  it('reuses an existing Company/Contact instead of creating a duplicate (case-insensitive email, normalized company name)', async () => {
    companies.findManyByNormalizedNames.mockResolvedValue([
      { id: 'existing_company', organizationId: orgId, clientId, rawName: 'Empresa Uno S.A.', normalizedName: 'empresa uno', suppressed: false, suppressedAt: null, suppressedReason: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
    ]);
    contacts.findManyByEmails.mockResolvedValue([
      { id: 'existing_contact', organizationId: orgId, clientId, companyId: 'existing_company', email: 'PERSONA@empresa.cl', firstName: null, lastName: null, fullName: 'Persona', jobTitle: null, phone: null, city: null, country: null, website: null, linkedin: null, customFields: {}, suppressed: false, suppressedAt: null, suppressedReason: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
    ]);

    await resolver.resolveForExecution(orgId, executionId, mailboxId);

    // Nothing new to create — createMany is skipped entirely rather than called with an empty batch.
    expect(companies.createMany).not.toHaveBeenCalled();
    expect(contacts.createMany).not.toHaveBeenCalled();
    expect(rows.bulkSetResolvedIdentity).toHaveBeenCalledWith(
      [{ rowId: 'row_1', companyId: 'existing_company', contactId: 'existing_contact' }],
      expect.any(Date),
      expect.anything(),
    );
  });

  it('never creates a Contact for a row without a valid email — the row stays unresolved, never rejected', async () => {
    rows.findByImport.mockResolvedValue([row({ email: 'not-an-email' })]);
    await resolver.resolveForExecution(orgId, executionId, mailboxId);
    expect(contacts.createMany).not.toHaveBeenCalled();
    expect(rows.bulkSetResolvedIdentity).not.toHaveBeenCalled();
  });

  it('is idempotent — a row already resolved (resolvedAt set) is never re-processed', async () => {
    rows.findByImport.mockResolvedValue([row({ resolvedAt: new Date() })]);
    await resolver.resolveForExecution(orgId, executionId, mailboxId);
    expect(companies.createMany).not.toHaveBeenCalled();
    expect(contacts.createMany).not.toHaveBeenCalled();
    expect(rows.bulkSetResolvedIdentity).not.toHaveBeenCalled();
  });

  it('does nothing when the mailbox has no resolved client yet (defensive — should not happen for an accepted execution)', async () => {
    mailboxes.findById.mockResolvedValue({ id: mailboxId, clientId: null } as never);
    await resolver.resolveForExecution(orgId, executionId, mailboxId);
    expect(imports.findByExecution).not.toHaveBeenCalled();
  });

  it('does nothing when there is no prospect import for this execution', async () => {
    imports.findByExecution.mockResolvedValue(null);
    await resolver.resolveForExecution(orgId, executionId, mailboxId);
    expect(rows.findByImport).not.toHaveBeenCalled();
  });

  it('never overwrites rawData/normalizedData — only companyId/contactId/resolvedAt are stamped', async () => {
    await resolver.resolveForExecution(orgId, executionId, mailboxId);
    const call = rows.bulkSetResolvedIdentity.mock.calls[0][0];
    expect(call[0]).toEqual({ rowId: 'row_1', companyId: expect.any(String), contactId: expect.any(String) });
  });
});
