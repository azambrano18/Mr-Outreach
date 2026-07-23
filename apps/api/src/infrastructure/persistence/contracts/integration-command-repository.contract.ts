import { IntegrationCommandRepository } from '../../../domain/integration/integration-command.repository';

export function runIntegrationCommandRepositoryContractTests(
  getRepository: () => IntegrationCommandRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  const baseInput = (overrides: Partial<Parameters<IntegrationCommandRepository['create']>[0]> = {}) => ({
    organizationId: 'fx_org_1',
    commandId: 'cmd_1',
    commandType: 'MAILBOX_PROVISION_REQUESTED' as const,
    aggregateType: 'MAILBOX' as const,
    aggregateId: 'mailbox_1',
    schemaVersion: '1.0',
    idempotencyKey: 'idem_1',
    correlationId: 'corr_1',
    payload: { foo: 'bar', nested: { a: 1 } },
    requestedBy: 'user_1',
    ...overrides,
  });

  it('creates a command defaulting to REQUESTED, storing the JSONB payload verbatim', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    expect(created.status).toBe('REQUESTED');
    expect(created.attemptCount).toBe(0);
    expect(created.payload).toEqual({ foo: 'bar', nested: { a: 1 } });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.sentAt).toBeNull();
  });

  it('enforces idempotencyKey uniqueness within the same organization', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    await expect(
      repo.create(baseInput({ commandId: 'cmd_2', idempotencyKey: 'idem_1' })),
    ).rejects.toThrow();
  });

  it('does not let one organization block another organization with the same idempotencyKey', async () => {
    const repo = getRepository();
    await repo.create(baseInput({ organizationId: 'fx_org_1', idempotencyKey: 'shared_key' }));

    await expect(
      repo.create(baseInput({ organizationId: 'fx_org_2', commandId: 'cmd_2', idempotencyKey: 'shared_key' })),
    ).resolves.toBeDefined();
  });

  it('findByIdempotencyKey scopes to organization', async () => {
    const repo = getRepository();
    await repo.create(baseInput({ organizationId: 'fx_org_1', idempotencyKey: 'idem_1' }));

    expect(await repo.findByIdempotencyKey('fx_org_1', 'idem_1')).not.toBeNull();
    expect(await repo.findByIdempotencyKey('fx_org_2', 'idem_1')).toBeNull();
  });

  it('findByCommandId scopes to organization (cross-tenant isolation)', async () => {
    const repo = getRepository();
    await repo.create(baseInput({ organizationId: 'fx_org_1', commandId: 'cmd_1' }));

    expect(await repo.findByCommandId('fx_org_1', 'cmd_1')).not.toBeNull();
    expect(await repo.findByCommandId('fx_org_2', 'cmd_1')).toBeNull();
  });

  it('findAll scopes to organization and supports status/aggregate filters', async () => {
    const repo = getRepository();
    await repo.create(baseInput({ organizationId: 'fx_org_1', commandId: 'cmd_1', aggregateId: 'mailbox_1' }));
    await repo.create(
      baseInput({ organizationId: 'fx_org_1', commandId: 'cmd_2', idempotencyKey: 'idem_2', aggregateId: 'mailbox_2' }),
    );
    await repo.create(baseInput({ organizationId: 'fx_org_2', commandId: 'cmd_3', idempotencyKey: 'idem_3' }));

    expect(await repo.findAll('fx_org_1')).toHaveLength(2);
    expect(await repo.findAll('fx_org_1', { aggregateId: 'mailbox_1' })).toHaveLength(1);
    expect(await repo.findAll('fx_org_2')).toHaveLength(1);
  });

  it('update transitions status and stamps dates, preserving other fields', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    const acceptedAt = new Date();
    const updated = await repo.update(created.id, { status: 'ACCEPTED', acceptedAt, sentAt: acceptedAt });

    expect(updated.status).toBe('ACCEPTED');
    expect(updated.acceptedAt?.getTime()).toBe(acceptedAt.getTime());
    expect(updated.payload).toEqual(created.payload);
    expect(updated.idempotencyKey).toBe(created.idempotencyKey);
  });
}
