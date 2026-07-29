import { randomUUID } from 'node:crypto';
import { PrismaSequenceExecutionRepository } from './prisma-sequence-execution.repository';
import { PrismaSequenceTemplateVersionRepository } from './prisma-sequence-template-version.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';

/**
 * Consolidación contractual §9 — real-PostgreSQL evidence (never mocks
 * alone) that:
 *   1. Publishing two accepted versions of the same Plantilla produces two
 *      DIFFERENT serverTemplateId values.
 *   2. The `serverTemplateId @unique` constraint holds — no conflict when
 *      each version gets its own id, and a real constraint violation when
 *      one is (incorrectly) reused.
 *   3. A Gestión created against v1 keeps referencing v1 after v2 is
 *      published; a new Gestión created afterward uses v2. Neither Gestión
 *      is ever mutated by the other version's existence.
 *
 * Runs only against mr-outreach-test (via `npm run test:integration`).
 */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

jest.setTimeout(30_000);

describeIfDatabaseAvailable('SequenceTemplateVersion publishing (PostgreSQL integration)', () => {
  let prisma: PrismaService;
  let versions: PrismaSequenceTemplateVersionRepository;
  let executions: PrismaSequenceExecutionRepository;
  const stamp = Date.now();

  let orgId: string;
  let userId: string;
  let mailboxId: string;
  let templateId: string;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
    versions = new PrismaSequenceTemplateVersionRepository(prisma);
    executions = new PrismaSequenceExecutionRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const suffix = `${stamp}_${randomUUID()}`;
    const org = await prisma.organization.create({ data: { name: `__consolidacion_versionado_${suffix}` } });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        firstName: 'Test',
        lastName: 'Executive',
        email: `exec_${suffix}@example.test`,
        passwordHash: 'irrelevant-for-this-test',
      },
    });
    userId = user.id;

    const mailbox = await prisma.mailbox.create({
      data: { organizationId: orgId, name: 'Ventas', email: `ventas_${suffix}@example.test`, fromName: 'Ventas' },
    });
    mailboxId = mailbox.id;

    const template = await prisma.sequenceTemplate.create({
      data: {
        organizationId: orgId,
        ownerUserId: userId,
        mailboxId,
        name: 'Plantilla de prueba de versionado',
        status: 'PUBLISHED',
      },
    });
    templateId = template.id;
  });

  afterEach(async () => {
    // Scoped to this test's own fresh organizationId only — never a blanket deleteMany.
    await prisma.sequenceExecution.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequenceTemplateVersion.deleteMany({ where: { templateId } });
    await prisma.sequenceTemplate.deleteMany({ where: { organizationId: orgId } });
    await prisma.mailbox.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  function versionSnapshot(overrides: { name: string }) {
    return {
      templateId,
      name: overrides.name,
      mailboxId,
      timezone: 'America/Santiago',
      subjectTemplate: 'Hola {contact_name}',
      signatureHtml: '<div>Firma</div>',
      variables: [],
      steps: [],
      lastPublishCommandId: `cmd_${randomUUID()}`,
      createdBy: userId,
    };
  }

  it('publishes two accepted versions with two DIFFERENT serverTemplateId values and no unique-constraint conflict', async () => {
    const v1 = await versions.create(versionSnapshot({ name: 'Plantilla de prueba de versionado' }));
    const v1Accepted = await versions.update(v1.id, {
      status: 'ACCEPTED',
      serverTemplateId: `tplv_server_${stamp}_001`,
      acceptedAt: new Date(),
    });

    const v2 = await versions.create({ ...versionSnapshot({ name: 'Plantilla de prueba de versionado' }), previousVersionNumber: v1.versionNumber });
    const v2Accepted = await versions.update(v2.id, {
      status: 'ACCEPTED',
      serverTemplateId: `tplv_server_${stamp}_002`,
      acceptedAt: new Date(),
    });

    expect(v1Accepted.serverTemplateId).not.toBeNull();
    expect(v2Accepted.serverTemplateId).not.toBeNull();
    expect(v1Accepted.serverTemplateId).not.toBe(v2Accepted.serverTemplateId);
    expect(v2.versionNumber).toBe(v1.versionNumber + 1);
  });

  it('rejects a real attempt to reuse an already-used serverTemplateId (proves the @unique constraint is live, not just assumed)', async () => {
    const v1 = await versions.create(versionSnapshot({ name: 'Plantilla A' }));
    await versions.update(v1.id, { status: 'ACCEPTED', serverTemplateId: `tplv_server_${stamp}_shared`, acceptedAt: new Date() });

    const v2 = await versions.create({ ...versionSnapshot({ name: 'Plantilla A' }), previousVersionNumber: v1.versionNumber });
    await expect(
      versions.update(v2.id, { status: 'ACCEPTED', serverTemplateId: `tplv_server_${stamp}_shared`, acceptedAt: new Date() }),
    ).rejects.toThrow();
  });

  it('an old Gestión keeps referencing v1 and a new Gestión uses v2 — publishing v2 never mutates the old one', async () => {
    const v1 = await versions.create(versionSnapshot({ name: 'Plantilla con Gestiones' }));
    await versions.update(v1.id, { status: 'ACCEPTED', serverTemplateId: `tplv_server_${stamp}_v1`, acceptedAt: new Date() });

    const oldExecution = await executions.create({
      organizationId: orgId,
      executiveId: userId,
      mailboxId,
      templateId,
      templateVersionId: v1.id,
      timezone: 'America/Santiago',
      createdBy: userId,
    });

    // Now publish v2 — the new "current" version for future Gestiones.
    const v2 = await versions.create({ ...versionSnapshot({ name: 'Plantilla con Gestiones' }), previousVersionNumber: v1.versionNumber });
    await versions.update(v2.id, { status: 'ACCEPTED', serverTemplateId: `tplv_server_${stamp}_v2`, acceptedAt: new Date() });

    const newExecution = await executions.create({
      organizationId: orgId,
      executiveId: userId,
      mailboxId,
      templateId,
      templateVersionId: v2.id,
      timezone: 'America/Santiago',
      createdBy: userId,
    });

    const reloadedOldExecution = await executions.findById(oldExecution.id);
    const reloadedNewExecution = await executions.findById(newExecution.id);

    expect(reloadedOldExecution?.templateVersionId).toBe(v1.id);
    expect(reloadedNewExecution?.templateVersionId).toBe(v2.id);
    expect(reloadedOldExecution?.templateVersionId).not.toBe(reloadedNewExecution?.templateVersionId);

    const latestAccepted = await versions.findLatestAcceptedByTemplate(templateId);
    expect(latestAccepted?.id).toBe(v2.id);
  });
});
