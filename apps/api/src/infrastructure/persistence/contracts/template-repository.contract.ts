import { TemplateRepository } from '../../../domain/template/template.repository';

export function runTemplateRepositoryContractTests(
  getRepository: () => TemplateRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  it('creates a template defaulting to ACTIVE', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'org_1',
      name: 'Primer contacto',
      subject: 'Hola {nombre}',
      body: 'Hola {nombre}, te escribo de {empresa}.',
    });

    expect(created.status).toBe('ACTIVE');
    expect(created.deletedAt).toBeNull();
  });

  it('scopes findAll to the given organization', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'org_1', name: 'A', subject: 'A', body: 'A' });
    await repo.create({ organizationId: 'org_2', name: 'B', subject: 'B', body: 'B' });

    const orgOneTemplates = await repo.findAll('org_1');

    expect(orgOneTemplates).toHaveLength(1);
  });

  it('updates only the provided fields', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'org_1',
      name: 'Original',
      subject: 'Asunto original',
      body: 'Cuerpo original',
    });

    const updated = await repo.update(created.id, { name: 'Renombrado' });

    expect(updated.name).toBe('Renombrado');
    expect(updated.subject).toBe('Asunto original');
    expect(updated.body).toBe('Cuerpo original');
  });

  it('softDelete hides the template from findById and findAll', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'org_1',
      name: 'Desechable',
      subject: 'X',
      body: 'X',
    });

    await repo.softDelete(created.id);

    expect(await repo.findById(created.id)).toBeNull();
    expect(await repo.findAll('org_1')).toHaveLength(0);
  });
}
