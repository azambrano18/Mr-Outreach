import { SequenceContactRepository } from '../../../domain/sequence-contact/sequence-contact.repository';

export function runSequenceContactRepositoryContractTests(
  getRepository: () => SequenceContactRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  const baseInput = () => ({
    organizationId: 'fx_org_1',
    clientId: 'fx_client_1',
    sequenceId: 'fx_sequence_1',
    sequenceVersion: 1,
    contactId: 'fx_contact_1',
    companyId: null,
    assignedMailboxId: 'fx_mailbox_1',
    assignedExecutiveId: 'fx_user_1',
    currentStepId: 'fx_step_1',
    currentStepPosition: 1,
  });

  it('creates a sequence contact defaulting to ACTIVE, recording sourceImportId when given', async () => {
    const repo = getRepository();
    const created = await repo.create({ ...baseInput(), sourceImportId: 'fx_import_1' });

    expect(created.status).toBe('ACTIVE');
    expect(created.sourceImportId).toBe('fx_import_1');
    expect(created.startedAt).toBeInstanceOf(Date);
  });

  it('defaults sourceImportId to null when not enrolled via an import', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    expect(created.sourceImportId).toBeNull();
  });

  it('enforces one enrollment per (sequenceId, contactId)', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    await expect(repo.create(baseInput())).rejects.toThrow();
  });

  it('findByContactAndSequence finds the existing enrollment', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    expect(await repo.findByContactAndSequence('fx_sequence_1', 'fx_contact_1')).not.toBeNull();
    expect(await repo.findByContactAndSequence('fx_sequence_org2', 'fx_contact_1')).toBeNull();
  });

  it('findBySequence scopes to organization and filters by status', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());
    await repo.update(created.id, { status: 'PAUSED' });

    expect(await repo.findBySequence('fx_org_1', 'fx_sequence_1')).toHaveLength(1);
    expect(await repo.findBySequence('fx_org_1', 'fx_sequence_1', { status: 'PAUSED' })).toHaveLength(1);
    expect(await repo.findBySequence('fx_org_1', 'fx_sequence_1', { status: 'ACTIVE' })).toHaveLength(0);
  });

  it('findByContact and findAllByOrganization scope to organization', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    expect(await repo.findByContact('fx_org_1', 'fx_contact_1')).toHaveLength(1);
    expect(await repo.findByContact('fx_org_2', 'fx_contact_1')).toHaveLength(0);
    expect(await repo.findAllByOrganization('fx_org_1')).toHaveLength(1);
    expect(await repo.findAllByOrganization('fx_org_2')).toHaveLength(0);
  });

  it('update transitions status and stamps completedAt/stopReason', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    const completedAt = new Date();
    const updated = await repo.update(created.id, {
      status: 'COMPLETED_MANUALLY',
      completedAt,
      stopReason: 'El ejecutivo cerró la gestión manualmente.',
    });

    expect(updated.status).toBe('COMPLETED_MANUALLY');
    expect(updated.completedAt?.getTime()).toBe(completedAt.getTime());
    expect(updated.stopReason).toBe('El ejecutivo cerró la gestión manualmente.');
  });
}
