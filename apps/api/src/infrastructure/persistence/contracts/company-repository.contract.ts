import { CompanyRepository } from '../../../domain/company/company.repository';

export function runCompanyRepositoryContractTests(
  getRepository: () => CompanyRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  it('creates a company deriving normalizedName from rawName', async () => {
    const repo = getRepository();
    const created = await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', rawName: 'Acme S.A.' });

    expect(created.normalizedName).toBe('acme');
    expect(created.suppressed).toBe(false);
    expect(created.deletedAt).toBeNull();
  });

  it('enforces normalizedName uniqueness within the same organization+client while not soft-deleted', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', rawName: 'Acme Inc' });

    await expect(
      repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', rawName: 'ACME INC' }),
    ).rejects.toThrow();
  });

  it('allows the same normalized name for a different client in the same organization', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', rawName: 'Acme Inc' });

    await expect(
      repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_2', rawName: 'Acme Inc' }),
    ).resolves.toBeDefined();
  });

  it('allows the same normalized name for a different organization', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', rawName: 'Acme Inc' });

    await expect(
      repo.create({ organizationId: 'fx_org_2', clientId: 'fx_client_1', rawName: 'Acme Inc' }),
    ).resolves.toBeDefined();
  });

  it('findByNormalizedName scopes to organization and client', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', rawName: 'Acme Inc' });

    expect(await repo.findByNormalizedName('fx_org_1', 'fx_client_1', 'acme')).not.toBeNull();
    expect(await repo.findByNormalizedName('fx_org_1', 'fx_client_2', 'acme')).toBeNull();
    expect(await repo.findByNormalizedName('fx_org_2', 'fx_client_1', 'acme')).toBeNull();
  });

  it('findByClient scopes to organization and client', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', rawName: 'A' });
    await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_2', rawName: 'B' });
    await repo.create({ organizationId: 'fx_org_2', clientId: 'fx_client_1', rawName: 'C' });

    const rows = await repo.findByClient('fx_org_1', 'fx_client_1');
    expect(rows).toHaveLength(1);
    expect(rows[0].rawName).toBe('A');
  });

  it('update persists suppression fields', async () => {
    const repo = getRepository();
    const created = await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', rawName: 'Acme Inc' });

    const suppressedAt = new Date();
    const updated = await repo.update(created.id, {
      suppressed: true,
      suppressedAt,
      suppressedReason: 'Cliente pidió exclusión global',
    });

    expect(updated.suppressed).toBe(true);
    expect(updated.suppressedReason).toBe('Cliente pidió exclusión global');
    expect(updated.suppressedAt?.getTime()).toBe(suppressedAt.getTime());
  });
}
