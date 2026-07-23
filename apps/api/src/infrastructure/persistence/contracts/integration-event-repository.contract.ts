import { IntegrationEventRepository } from '../../../domain/integration/integration-event.repository';

export function runIntegrationEventRepositoryContractTests(
  getRepository: () => IntegrationEventRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  const baseInput = (overrides: Partial<Parameters<IntegrationEventRepository['create']>[0]> = {}) => ({
    organizationId: 'fx_org_1',
    eventId: 'evt_1',
    eventType: 'MAILBOX_PROVISION_ACCEPTED' as const,
    commandId: 'cmd_1',
    correlationId: 'corr_1',
    schemaVersion: '1.0',
    payload: { ok: true },
    origin: 'SIMULATED' as const,
    ...overrides,
  });

  it('creates an event defaulting to RECEIVED', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    expect(created.status).toBe('RECEIVED');
    expect(created.processedAt).toBeNull();
    expect(created.payload).toEqual({ ok: true });
  });

  it('enforces (organizationId, eventId, origin) uniqueness — the §45 dedupe key', async () => {
    const repo = getRepository();
    await repo.create(baseInput());

    await expect(repo.create(baseInput())).rejects.toThrow();
  });

  it('allows the same eventId with a different origin', async () => {
    const repo = getRepository();
    await repo.create(baseInput({ origin: 'SIMULATED' }));

    await expect(repo.create(baseInput({ origin: 'REMOTE' }))).resolves.toBeDefined();
  });

  it('allows the same eventId+origin in a different organization', async () => {
    const repo = getRepository();
    await repo.create(baseInput({ organizationId: 'fx_org_1' }));

    await expect(repo.create(baseInput({ organizationId: 'fx_org_2' }))).resolves.toBeDefined();
  });

  it('findByEventId scopes to organization and origin', async () => {
    const repo = getRepository();
    await repo.create(baseInput({ organizationId: 'fx_org_1', eventId: 'evt_1', origin: 'SIMULATED' }));

    expect(await repo.findByEventId('fx_org_1', 'evt_1', 'SIMULATED')).not.toBeNull();
    expect(await repo.findByEventId('fx_org_1', 'evt_1', 'REMOTE')).toBeNull();
    expect(await repo.findByEventId('fx_org_2', 'evt_1', 'SIMULATED')).toBeNull();
  });

  it('findAll filters by commandId and scopes to organization', async () => {
    const repo = getRepository();
    await repo.create(baseInput({ organizationId: 'fx_org_1', eventId: 'evt_1', commandId: 'cmd_1' }));
    await repo.create(baseInput({ organizationId: 'fx_org_1', eventId: 'evt_2', commandId: 'cmd_2' }));
    await repo.create(baseInput({ organizationId: 'fx_org_2', eventId: 'evt_3', commandId: 'cmd_1' }));

    expect(await repo.findAll('fx_org_1', { commandId: 'cmd_1' })).toHaveLength(1);
    expect(await repo.findAll('fx_org_1')).toHaveLength(2);
  });

  it('update marks an event as processed', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    const processedAt = new Date();
    const updated = await repo.update(created.id, { status: 'PROCESSED', processedAt });

    expect(updated.status).toBe('PROCESSED');
    expect(updated.processedAt?.getTime()).toBe(processedAt.getTime());
  });
}
