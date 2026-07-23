import { SequenceImportRowRepository } from '../../../domain/sequence-import-row/sequence-import-row.repository';

const IMPORT_ID = 'fx_import_1';

export function runSequenceImportRowRepositoryContractTests(
  getRepository: () => SequenceImportRowRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  it('replaceForImport persists every row (accepted and rejected) with rawData as JSONB', async () => {
    const repo = getRepository();
    const rows = await repo.replaceForImport('fx_org_1', IMPORT_ID, [
      {
        organizationId: 'fx_org_1',
        importId: IMPORT_ID,
        rowNumber: 1,
        rawData: { Correo: 'ana@example.com', Nombre: 'Ana' },
        normalizedData: {
          email: 'ana@example.com',
          firstName: 'Ana',
          lastName: null,
          fullName: null,
          companyRawName: null,
          jobTitle: null,
          phone: null,
          city: null,
          country: null,
          website: null,
          linkedin: null,
        },
        email: 'ana@example.com',
        validationStatus: 'VALID',
      },
      {
        organizationId: 'fx_org_1',
        importId: IMPORT_ID,
        rowNumber: 2,
        rawData: { Correo: 'no-es-un-correo' },
        email: null,
        validationStatus: 'INVALID',
        rejectionReason: 'Correo inválido: no-es-un-correo',
      },
    ]);

    expect(rows).toHaveLength(2);
    const validRow = rows.find((r) => r.rowNumber === 1)!;
    expect(validRow.validationStatus).toBe('VALID');
    expect(validRow.normalizedData?.firstName).toBe('Ana');
    expect(validRow.rawData).toEqual({ Correo: 'ana@example.com', Nombre: 'Ana' });
    const invalidRow = rows.find((r) => r.rowNumber === 2)!;
    expect(invalidRow.validationStatus).toBe('INVALID');
    expect(invalidRow.rejectionReason).toBe('Correo inválido: no-es-un-correo');
    expect(invalidRow.contactId).toBeNull();
  });

  it('replaceForImport replaces (does not append to) rows from a prior call', async () => {
    const repo = getRepository();
    await repo.replaceForImport('fx_org_1', IMPORT_ID, [
      { organizationId: 'fx_org_1', importId: IMPORT_ID, rowNumber: 1, rawData: { a: '1' }, validationStatus: 'VALID' },
    ]);

    const second = await repo.replaceForImport('fx_org_1', IMPORT_ID, [
      { organizationId: 'fx_org_1', importId: IMPORT_ID, rowNumber: 1, rawData: { a: '2' }, validationStatus: 'INVALID' },
    ]);

    expect(second).toHaveLength(1);
    expect(second[0].rawData).toEqual({ a: '2' });
    expect(second[0].validationStatus).toBe('INVALID');
  });

  it('findByImport filters by validationStatus and scopes to organization', async () => {
    const repo = getRepository();
    await repo.replaceForImport('fx_org_1', IMPORT_ID, [
      { organizationId: 'fx_org_1', importId: IMPORT_ID, rowNumber: 1, rawData: {}, validationStatus: 'VALID' },
      { organizationId: 'fx_org_1', importId: IMPORT_ID, rowNumber: 2, rawData: {}, validationStatus: 'DUPLICATE' },
    ]);

    expect(await repo.findByImport('fx_org_1', IMPORT_ID)).toHaveLength(2);
    expect(await repo.findByImport('fx_org_1', IMPORT_ID, { validationStatus: 'VALID' })).toHaveLength(1);
    expect(await repo.findByImport('fx_org_2', IMPORT_ID)).toHaveLength(0);
  });

  it('update sets the contactId once a Contact is materialized for the row', async () => {
    const repo = getRepository();
    const [row] = await repo.replaceForImport('fx_org_1', IMPORT_ID, [
      { organizationId: 'fx_org_1', importId: IMPORT_ID, rowNumber: 1, rawData: {}, validationStatus: 'VALID' },
    ]);

    const updated = await repo.update(row.id, { contactId: 'fx_contact_1' });

    expect(updated.contactId).toBe('fx_contact_1');
  });
}
