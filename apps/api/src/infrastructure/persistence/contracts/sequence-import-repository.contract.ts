import { SequenceImportRepository } from '../../../domain/sequence-import/sequence-import.repository';

export function runSequenceImportRepositoryContractTests(
  getRepository: () => SequenceImportRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  const baseInput = () => ({
    organizationId: 'fx_org_1',
    clientId: 'fx_client_1',
    sequenceId: 'fx_sequence_1',
    executiveId: 'fx_user_1',
    mailboxId: 'fx_mailbox_1',
    fileName: 'contacts.xlsx',
    storageKey: 'import_abc123',
    checksum: 'deadbeef',
    totalRows: 10,
    createdBy: 'fx_user_1',
  });

  it('creates an import defaulting to UPLOADED with zeroed counters', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    expect(created.status).toBe('UPLOADED');
    expect(created.validRows).toBe(0);
    expect(created.rejections).toEqual([]);
    expect(created.commandId).toBeNull();
  });

  it('findBySequence scopes to organization and sequence', async () => {
    const repo = getRepository();
    await repo.create(baseInput());
    await repo.create({ ...baseInput(), organizationId: 'fx_org_2', sequenceId: 'fx_sequence_org2' });

    expect(await repo.findBySequence('fx_org_1', 'fx_sequence_1')).toHaveLength(1);
    expect(await repo.findBySequence('fx_org_2', 'fx_sequence_1')).toHaveLength(0);
  });

  it('update persists status, mapping, rejections and counters (JSONB round-trip)', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    const updated = await repo.update(created.id, {
      status: 'READY',
      columnMapping: { email: 'Correo', firstName: 'Nombre' },
      validRows: 8,
      invalidRows: 2,
      rejections: [{ row: 3, reason: 'INVALID_EMAIL', detail: 'Correo inválido: x' }],
    });

    expect(updated.status).toBe('READY');
    expect(updated.columnMapping).toEqual({ email: 'Correo', firstName: 'Nombre' });
    expect(updated.validRows).toBe(8);
    expect(updated.rejections).toEqual([{ row: 3, reason: 'INVALID_EMAIL', detail: 'Correo inválido: x' }]);
  });

  it('findById returns null for an unknown id', async () => {
    const repo = getRepository();
    expect(await repo.findById('does-not-exist')).toBeNull();
  });
}
