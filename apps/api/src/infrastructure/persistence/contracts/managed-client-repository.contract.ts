import { ManagedClientRepository } from '../../../domain/client/managed-client.repository';

export function runManagedClientRepositoryContractTests(
  getRepository: () => ManagedClientRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  const baseInput = () => ({
    organizationId: 'fx_org_1',
    serverClientId: 'srv_501',
    name: 'Acme Inc',
    createdBy: 'fx_user_1',
  });

  it('creates a ManagedClient defaulting to ACTIVE with null external snapshots when omitted', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    expect(created.status).toBe('ACTIVE');
    expect(created.clientRutSnapshot).toBeNull();
    expect(created.externalStatusSnapshot).toBeNull();
    expect(created.externalStatusCheckedAt).toBeNull();
  });

  it('persists clientRutSnapshot, externalStatusSnapshot and externalStatusCheckedAt', async () => {
    const repo = getRepository();
    const checkedAt = new Date('2026-01-01T10:00:00Z');
    const created = await repo.create({
      ...baseInput(),
      clientRutSnapshot: '76.123.456-7',
      externalStatusSnapshot: 'ACTIVO',
      externalStatusCheckedAt: checkedAt,
    });

    expect(created.clientRutSnapshot).toBe('76.123.456-7');
    expect(created.externalStatusSnapshot).toBe('ACTIVO');
    expect(created.externalStatusCheckedAt?.getTime()).toBe(checkedAt.getTime());

    const reloaded = await repo.findById(created.id);
    expect(reloaded?.clientRutSnapshot).toBe('76.123.456-7');
    expect(reloaded?.externalStatusSnapshot).toBe('ACTIVO');
    expect(reloaded?.externalStatusCheckedAt?.getTime()).toBe(checkedAt.getTime());
  });

  it('enforces the serverClientId unique constraint', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    await expect(repo.create(baseInput())).rejects.toThrow();
  });

  it('rejects the same serverClientId even across different organizations (globally unique — Fase 2.1)', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    await expect(repo.create({ ...baseInput(), organizationId: 'fx_org_2' })).rejects.toThrow();
  });

  it('findByServerClientId scopes to organization', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    expect(await repo.findByServerClientId('fx_org_1', 'srv_501')).not.toBeNull();
    expect(await repo.findByServerClientId('fx_org_2', 'srv_501')).toBeNull();
  });

  it('update (the "second upsert") refreshes the external snapshot without touching operational fields', async () => {
    const repo = getRepository();
    const created = await repo.create({
      ...baseInput(),
      legalName: 'Acme Inc S.A.',
      notes: 'Cliente VIP',
      externalStatusSnapshot: 'ACTIVO',
    });

    const updated = await repo.update(created.id, {
      name: 'Acme Incorporated',
      industry: 'Tecnología',
      clientRutSnapshot: '76.999.999-9',
      externalStatusSnapshot: 'INACTIVO',
      externalStatusCheckedAt: new Date('2026-02-01T00:00:00Z'),
      updatedBy: 'fx_user_1',
    });

    expect(updated.name).toBe('Acme Incorporated');
    expect(updated.externalStatusSnapshot).toBe('INACTIVO');
    // Operational fields untouched by the external-only patch:
    expect(updated.legalName).toBe('Acme Inc S.A.');
    expect(updated.notes).toBe('Cliente VIP');
    expect(updated.createdBy).toBe(created.createdBy);
    expect(updated.createdAt.getTime()).toBe(created.createdAt.getTime());
  });

  it('findAll scopes to organization', async () => {
    // fx_org_1 is a fixture organization shared with other Fase 1 contract
    // specs (Company/Contact/SequenceImport family also create their own
    // ManagedClient rows there via seedManagedClients) — assert this row is
    // present rather than an exact count, and that org_2 never sees it.
    const repo = getRepository();
    const created = await repo.create(baseInput());
    await repo.create({ ...baseInput(), organizationId: 'fx_org_2', serverClientId: 'srv_502' });

    const org1Results = await repo.findAll('fx_org_1');
    expect(org1Results.map((c) => c.id)).toContain(created.id);

    const org2Results = await repo.findAll('fx_org_2');
    expect(org2Results.map((c) => c.serverClientId)).toContain('srv_502');
    expect(org2Results.map((c) => c.id)).not.toContain(created.id);
  });
}
