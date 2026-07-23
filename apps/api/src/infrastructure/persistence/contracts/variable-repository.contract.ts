import { VariableRepository } from '../../../domain/variable/variable.repository';

export function runVariableRepositoryContractTests(
  getRepository: () => VariableRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  it('creates a variable defaulting to ACTIVE', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'org_1',
      key: 'nombre',
      label: 'Nombre del contacto',
      source: 'CONTACT',
    });

    expect(created.status).toBe('ACTIVE');
    expect(created.description).toBeNull();
  });

  it('enforces key uniqueness within the same organization', async () => {
    const repo = getRepository();
    await repo.create({
      organizationId: 'org_1',
      key: 'nombre',
      label: 'Nombre del contacto',
      source: 'CONTACT',
    });

    await expect(
      repo.create({
        organizationId: 'org_1',
        key: 'nombre',
        label: 'Duplicado',
        source: 'CUSTOM',
      }),
    ).rejects.toThrow();
  });

  it('allows the same key in different organizations', async () => {
    const repo = getRepository();
    await repo.create({
      organizationId: 'org_1',
      key: 'nombre',
      label: 'Nombre del contacto',
      source: 'CONTACT',
    });

    await expect(
      repo.create({
        organizationId: 'org_2',
        key: 'nombre',
        label: 'Nombre del contacto',
        source: 'CONTACT',
      }),
    ).resolves.toBeDefined();
  });

  it('scopes findAll to the given organization', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'org_1', key: 'a', label: 'A', source: 'CONTACT' });
    await repo.create({ organizationId: 'org_2', key: 'b', label: 'B', source: 'CONTACT' });

    const orgOneVariables = await repo.findAll('org_1');

    expect(orgOneVariables).toHaveLength(1);
  });

  it('updates only the provided fields', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'org_1',
      key: 'nombre',
      label: 'Original',
      source: 'CONTACT',
    });

    const updated = await repo.update(created.id, { label: 'Renombrada' });

    expect(updated.label).toBe('Renombrada');
    expect(updated.key).toBe('nombre');
    expect(updated.source).toBe('CONTACT');
  });

  it('rejects renaming a key to one already used by another variable in the org', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'org_1', key: 'nombre', label: 'A', source: 'CONTACT' });
    const other = await repo.create({
      organizationId: 'org_1',
      key: 'empresa',
      label: 'B',
      source: 'CONTACT',
    });

    await expect(repo.update(other.id, { key: 'nombre' })).rejects.toThrow();
  });

  it('findByKey finds an existing variable scoped to the organization', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'org_1', key: 'nombre', label: 'A', source: 'CONTACT' });

    expect(await repo.findByKey('org_1', 'nombre')).not.toBeNull();
    expect(await repo.findByKey('org_2', 'nombre')).toBeNull();
  });

  it('remove deletes the variable outright', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'org_1',
      key: 'nombre',
      label: 'A',
      source: 'CONTACT',
    });

    await repo.remove(created.id);

    expect(await repo.findById(created.id)).toBeNull();
  });
}
