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
    crmClientId: 501,
    name: 'Acme Inc',
    createdBy: 'fx_user_1',
  });

  it('creates a ManagedClient defaulting to ACTIVE with null CRM snapshots when omitted', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    expect(created.status).toBe('ACTIVE');
    expect(created.crmRutSnapshot).toBeNull();
    expect(created.crmStatusSnapshot).toBeNull();
    expect(created.crmStatusCheckedAt).toBeNull();
  });

  it('persists crmRutSnapshot, crmStatusSnapshot and crmStatusCheckedAt (Fase 1.5)', async () => {
    const repo = getRepository();
    const checkedAt = new Date('2026-01-01T10:00:00Z');
    const created = await repo.create({
      ...baseInput(),
      crmRutSnapshot: '76.123.456-7',
      crmStatusSnapshot: 'ACTIVO',
      crmStatusCheckedAt: checkedAt,
    });

    expect(created.crmRutSnapshot).toBe('76.123.456-7');
    expect(created.crmStatusSnapshot).toBe('ACTIVO');
    expect(created.crmStatusCheckedAt?.getTime()).toBe(checkedAt.getTime());

    const reloaded = await repo.findById(created.id);
    expect(reloaded?.crmRutSnapshot).toBe('76.123.456-7');
    expect(reloaded?.crmStatusSnapshot).toBe('ACTIVO');
    expect(reloaded?.crmStatusCheckedAt?.getTime()).toBe(checkedAt.getTime());
  });

  it('enforces the (organizationId, crmClientId) unique constraint', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    await expect(repo.create(baseInput())).rejects.toThrow();
  });

  it('allows the same crmClientId in a different organization', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    await expect(repo.create({ ...baseInput(), organizationId: 'fx_org_2' })).resolves.toBeDefined();
  });

  it('findByCrmClientId scopes to organization', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    expect(await repo.findByCrmClientId('fx_org_1', 501)).not.toBeNull();
    expect(await repo.findByCrmClientId('fx_org_2', 501)).toBeNull();
  });

  it('update (the "second upsert") refreshes the CRM snapshot without touching operational fields', async () => {
    const repo = getRepository();
    const created = await repo.create({
      ...baseInput(),
      legalName: 'Acme Inc S.A.',
      notes: 'Cliente VIP',
      crmStatusSnapshot: 'ACTIVO',
    });

    const updated = await repo.update(created.id, {
      name: 'Acme Incorporated',
      industry: 'Tecnología',
      crmRutSnapshot: '76.999.999-9',
      crmStatusSnapshot: 'INACTIVO',
      crmStatusCheckedAt: new Date('2026-02-01T00:00:00Z'),
      updatedBy: 'fx_user_1',
    });

    expect(updated.name).toBe('Acme Incorporated');
    expect(updated.crmStatusSnapshot).toBe('INACTIVO');
    // Operational fields untouched by the CRM-only patch:
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
    await repo.create({ ...baseInput(), organizationId: 'fx_org_2', crmClientId: 502 });

    const org1Results = await repo.findAll('fx_org_1');
    expect(org1Results.map((c) => c.id)).toContain(created.id);

    const org2Results = await repo.findAll('fx_org_2');
    expect(org2Results.map((c) => c.crmClientId)).toContain(502);
    expect(org2Results.map((c) => c.id)).not.toContain(created.id);
  });
}
