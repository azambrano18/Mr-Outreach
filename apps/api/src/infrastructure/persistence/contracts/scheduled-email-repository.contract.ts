import { ScheduledEmailRepository } from '../../../domain/scheduled-email/scheduled-email.repository';

export function runScheduledEmailRepositoryContractTests(
  getRepository: () => ScheduledEmailRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  const baseInput = (overrides: Partial<Parameters<ScheduledEmailRepository['create']>[0]> = {}) => ({
    organizationId: 'fx_org_1',
    sequenceId: 'fx_sequence_1',
    sequenceVersion: 1,
    sequenceContactId: 'fx_seqcontact_1',
    contactId: 'fx_contact_1',
    companyId: null,
    sequenceStepId: 'fx_step_1',
    stepVersion: 1,
    mailboxId: 'fx_mailbox_1',
    batchId: 'batch_1',
    scheduledAt: new Date('2026-01-01T10:00:00Z'),
    priority: 'NEW_CONTACT' as const,
    idempotencyKey: 'scheduled-email:fx_seqcontact_1:fx_step_1:1',
    ...overrides,
  });

  it('creates a scheduled email defaulting to PENDING', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    expect(created.status).toBe('PENDING');
    expect(created.attemptCount).toBe(0);
    expect(created.sentAt).toBeNull();
  });

  it('enforces idempotencyKey uniqueness within the same organization', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    await expect(repo.create(baseInput())).rejects.toThrow();
  });

  it('does not let one organization block another organization with the same idempotencyKey', async () => {
    const repo = getRepository();
    await repo.create(baseInput({ organizationId: 'fx_org_1' }));

    await expect(repo.create(baseInput({ organizationId: 'fx_org_2' }))).resolves.toBeDefined();
  });

  it('findByIdempotencyKey scopes to organization', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    expect(await repo.findByIdempotencyKey('fx_org_1', baseInput().idempotencyKey)).not.toBeNull();
    expect(await repo.findByIdempotencyKey('fx_org_2', baseInput().idempotencyKey)).toBeNull();
  });

  it('findBySequenceContact orders by scheduledAt', async () => {
    const repo = getRepository();
    await repo.create(baseInput({ scheduledAt: new Date('2026-01-02T10:00:00Z'), idempotencyKey: 'k2', sequenceStepId: 'fx_step_1' }));
    await repo.create(baseInput({ scheduledAt: new Date('2026-01-01T10:00:00Z'), idempotencyKey: 'k1' }));

    const rows = await repo.findBySequenceContact('fx_seqcontact_1');
    expect(rows).toHaveLength(2);
    expect(rows[0].idempotencyKey).toBe('k1');
  });

  it('findAll filters by status and batchId, scoped to organization', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());
    await repo.update(created.id, { status: 'SENT' });

    expect(await repo.findAll('fx_org_1', { status: 'SENT' })).toHaveLength(1);
    expect(await repo.findAll('fx_org_1', { status: 'CANCELLED' })).toHaveLength(0);
    expect(await repo.findAll('fx_org_1', { batchId: 'batch_1' })).toHaveLength(1);
    expect(await repo.findAll('fx_org_2')).toHaveLength(0);
  });

  it('update records cancellation, preserving history fields', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    const cancelledAt = new Date();
    const updated = await repo.update(created.id, {
      status: 'CANCELLED',
      cancelledAt,
      cancellationReason: 'Contacto retirado de la secuencia.',
    });

    expect(updated.status).toBe('CANCELLED');
    expect(updated.cancelledAt?.getTime()).toBe(cancelledAt.getTime());
    expect(updated.cancellationReason).toBe('Contacto retirado de la secuencia.');
  });

  it('update records the sent snapshot and Message-ID/threading headers', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    const sentAt = new Date();
    const updated = await repo.update(created.id, {
      status: 'SENT',
      sentAt,
      subjectSnapshot: 'Asunto',
      htmlBodySnapshot: '<p>hi</p>',
      plainTextBodySnapshot: 'hi',
      messageIdHeader: '<abc@mailengine.mroutreach.local>',
    });

    expect(updated.status).toBe('SENT');
    expect(updated.subjectSnapshot).toBe('Asunto');
    expect(updated.messageIdHeader).toBe('<abc@mailengine.mroutreach.local>');
  });
}
