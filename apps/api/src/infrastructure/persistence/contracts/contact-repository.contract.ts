import { ContactRepository } from '../../../domain/contact/contact.repository';

export function runContactRepositoryContractTests(
  getRepository: () => ContactRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  it('creates a contact with custom fields persisted as JSONB', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'fx_org_1',
      clientId: 'fx_client_1',
      companyId: null,
      email: 'ana@example.com',
      firstName: 'Ana',
      customFields: { plan: 'Enterprise', headcount: '250' },
    });

    expect(created.customFields).toEqual({ plan: 'Enterprise', headcount: '250' });
    expect(created.suppressed).toBe(false);
    expect(created.deletedAt).toBeNull();
  });

  it('defaults customFields to an empty object when omitted', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'fx_org_1',
      clientId: 'fx_client_1',
      companyId: null,
      email: 'ana@example.com',
    });

    expect(created.customFields).toEqual({});
  });

  it('enforces email uniqueness within the same organization+client, case-insensitively', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', companyId: null, email: 'Ana@Example.com' });

    await expect(
      repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', companyId: null, email: 'ana@example.com' }),
    ).rejects.toThrow();
  });

  it('allows the same email for a different client in the same organization', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', companyId: null, email: 'ana@example.com' });

    await expect(
      repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_2', companyId: null, email: 'ana@example.com' }),
    ).resolves.toBeDefined();
  });

  it('allows the same email for a different organization', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', companyId: null, email: 'ana@example.com' });

    await expect(
      repo.create({ organizationId: 'fx_org_2', clientId: 'fx_client_1', companyId: null, email: 'ana@example.com' }),
    ).resolves.toBeDefined();
  });

  it('findByEmail matches case-insensitively and scopes to organization+client', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', companyId: null, email: 'ana@example.com' });

    expect(await repo.findByEmail('fx_org_1', 'fx_client_1', 'ANA@EXAMPLE.COM')).not.toBeNull();
    expect(await repo.findByEmail('fx_org_1', 'fx_client_2', 'ana@example.com')).toBeNull();
    expect(await repo.findByEmail('fx_org_2', 'fx_client_1', 'ana@example.com')).toBeNull();
  });

  it('findByClient scopes to organization and client', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_1', companyId: null, email: 'a@example.com' });
    await repo.create({ organizationId: 'fx_org_1', clientId: 'fx_client_2', companyId: null, email: 'b@example.com' });

    const rows = await repo.findByClient('fx_org_1', 'fx_client_1');
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('a@example.com');
  });

  it('update persists suppression fields', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'fx_org_1',
      clientId: 'fx_client_1',
      companyId: null,
      email: 'ana@example.com',
    });

    const updated = await repo.update(created.id, { suppressed: true, suppressedReason: 'No contactar' });

    expect(updated.suppressed).toBe(true);
    expect(updated.suppressedReason).toBe('No contactar');
  });
}
