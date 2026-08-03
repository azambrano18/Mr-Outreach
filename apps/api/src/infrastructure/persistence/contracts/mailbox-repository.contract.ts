import { MailboxRepository } from '../../../domain/mailbox/mailbox.repository';

const protocolConfig = (username: string) => ({
  host: 'imap.example.com',
  port: 993,
  encryption: 'SSL_TLS' as const,
  username,
  verifyCertificate: true,
  secretCiphertext: 'iv.tag.cipher',
});

export function runMailboxRepositoryContractTests(
  getRepository: () => MailboxRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  it('creates a mailbox defaulting to ACTIVE / NOT_TESTED', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'org_1',
      name: 'Ventas',
      email: 'ventas@example.com',
      fromName: 'Equipo de Ventas',
      imap: protocolConfig('ventas@example.com'),
      smtp: protocolConfig('ventas@example.com'),
    });

    expect(created.status).toBe('ACTIVE');
    expect(created.connectionStatus).toBe('NOT_TESTED');
    expect(created.imap!.secretCiphertext).toBe('iv.tag.cipher');
  });

  it('enforces email uniqueness within the same organization', async () => {
    const repo = getRepository();
    await repo.create({
      organizationId: 'org_1',
      name: 'Ventas',
      email: 'ventas@example.com',
      fromName: 'Equipo de Ventas',
      imap: protocolConfig('ventas@example.com'),
      smtp: protocolConfig('ventas@example.com'),
    });

    await expect(
      repo.create({
        organizationId: 'org_1',
        name: 'Duplicado',
        email: 'ventas@example.com',
        fromName: 'Otro',
        imap: protocolConfig('otro@example.com'),
        smtp: protocolConfig('otro@example.com'),
      }),
    ).rejects.toThrow();
  });

  it('scopes findAll to the given organization', async () => {
    const repo = getRepository();
    await repo.create({
      organizationId: 'org_1',
      name: 'A',
      email: 'a@example.com',
      fromName: 'A',
      imap: protocolConfig('a@example.com'),
      smtp: protocolConfig('a@example.com'),
    });
    await repo.create({
      organizationId: 'org_2',
      name: 'B',
      email: 'b@example.com',
      fromName: 'B',
      imap: protocolConfig('b@example.com'),
      smtp: protocolConfig('b@example.com'),
    });

    const orgOneMailboxes = await repo.findAll('org_1');

    expect(orgOneMailboxes).toHaveLength(1);
  });

  it('partially updates only the imap fields provided, leaving the rest untouched', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'org_1',
      name: 'Ventas',
      email: 'ventas@example.com',
      fromName: 'Equipo de Ventas',
      imap: protocolConfig('ventas@example.com'),
      smtp: protocolConfig('ventas@example.com'),
    });

    const updated = await repo.update(created.id, { imap: { host: 'imap2.example.com' } });

    expect(updated.imap!.host).toBe('imap2.example.com');
    expect(updated.imap!.port).toBe(993);
    expect(updated.imap!.secretCiphertext).toBe('iv.tag.cipher');
    expect(updated.smtp!.host).toBe('imap.example.com');
  });

  /**
   * Regression test for a bug where PrismaMailboxRepository.update()'s
   * explicit field mapping omitted `deletedAt`: DeleteMailboxUseCase's
   * write silently never reached Postgres, so the mailbox kept appearing
   * in every listing as "Desvinculada" (REVOKED, deletedAt still null)
   * even though `mailbox.delete`/`mailbox.asset_cleanup_completed` were
   * both audited. Runs against every driver via this shared contract, so
   * a future field addition that repeats the same omission fails here
   * immediately, on both memory and Postgres.
   */
  it('persists deletedAt on update — the mailbox then disappears from findAll/findById/findByEmail', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'org_1',
      name: 'Ventas',
      email: 'ventas@example.com',
      fromName: 'Equipo de Ventas',
      imap: protocolConfig('ventas@example.com'),
      smtp: protocolConfig('ventas@example.com'),
    });

    const deletionTimestamp = new Date();
    const updated = await repo.update(created.id, { deletedAt: deletionTimestamp });
    expect(updated.deletedAt).toEqual(deletionTimestamp);

    expect(await repo.findById(created.id)).toBeNull();
    expect(await repo.findByEmail('org_1', 'ventas@example.com')).toBeNull();
    expect(await repo.findAll('org_1')).toHaveLength(0);

    // The row itself still exists — soft delete, never a hard delete.
    const stillThere = await repo.findByIdIncludingDeleted(created.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.deletedAt).toEqual(deletionTimestamp);
  });
}
