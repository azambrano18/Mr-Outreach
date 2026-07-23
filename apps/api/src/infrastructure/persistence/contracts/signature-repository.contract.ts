import { SignatureRepository } from '../../../domain/signature/signature.repository';

export function runSignatureRepositoryContractTests(
  getRepository: () => SignatureRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  it('creates a signature defaulting to ACTIVE with no active version yet', async () => {
    const repo = getRepository();
    const created = await repo.create({ organizationId: 'org_1', mailboxId: 'mailbox_1' });

    expect(created.status).toBe('ACTIVE');
    expect(created.activeVersionId).toBeNull();
  });

  it('enforces one signature per mailbox', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'org_1', mailboxId: 'mailbox_1' });

    await expect(
      repo.create({ organizationId: 'org_1', mailboxId: 'mailbox_1' }),
    ).rejects.toThrow();
  });

  it('findByMailbox finds the signature for that mailbox only', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'org_1', mailboxId: 'mailbox_1' });

    expect(await repo.findByMailbox('mailbox_1')).not.toBeNull();
    expect(await repo.findByMailbox('mailbox_2')).toBeNull();
  });

  it('updates the active version pointer without touching status', async () => {
    const repo = getRepository();
    const created = await repo.create({ organizationId: 'org_1', mailboxId: 'mailbox_1' });

    const updated = await repo.update(created.id, { activeVersionId: 'version_1' });

    expect(updated.activeVersionId).toBe('version_1');
    expect(updated.status).toBe('ACTIVE');
  });

  it('updates the status without touching the active version pointer', async () => {
    const repo = getRepository();
    const created = await repo.create({ organizationId: 'org_1', mailboxId: 'mailbox_1' });
    await repo.update(created.id, { activeVersionId: 'version_1' });

    const archived = await repo.update(created.id, { status: 'ARCHIVED' });

    expect(archived.status).toBe('ARCHIVED');
    expect(archived.activeVersionId).toBe('version_1');
  });
}
