import { Mailbox } from '../../../domain/mailbox/mailbox.entity';
import { InMemoryConversationRepository } from './in-memory-conversation.repository';
import { MemoryStore } from './memory-store';

function buildMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'mailbox-1',
    organizationId: 'org-1',
    clientId: null,
    domainId: null,
    name: 'Ventas',
    email: 'ventas@example.com',
    fromName: 'Equipo de Ventas',
    replyTo: null,
    status: 'ACTIVE',
    connectionStatus: 'NOT_TESTED',
    provisioningStatus: 'NOT_PROVISIONED',
    timezone: 'America/Santiago',
    sendingLimits: { dailyLimit: 40, minimumIntervalSeconds: 60, maximumIntervalSeconds: 180 },
    lastProvisionCommandId: null,
    lastTestedAt: null,
    lastTestedBy: null,
    lastTestMessage: null,
    imap: null,
    smtp: null,
    linkSource: 'SERVER_TOKEN',
    linkStatus: 'ACTIVE',
    serverMailboxId: null,
    serverDomainId: null,
    serverClientId: null,
    serverRedemptionId: null,
    tokenFingerprint: null,
    emailSnapshot: null,
    domainSnapshot: null,
    clientNameSnapshot: null,
    serverStatusSnapshot: null,
    serverCanSendSnapshot: null,
    serverStatusCheckedAt: null,
    linkedAt: null,
    linkedBy: null,
    unlinkRequestedAt: null,
    unlinkRequestedBy: null,
    unlinkReason: null,
    unlinkRemoveAssignments: false,
    revokedAt: null,
    revocationId: null,
    lastLinkCommandId: null,
    assetCleanupStatus: 'NOT_NEEDED',
    assetCleanupAttempts: 0,
    lastAssetCleanupError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('InMemoryConversationRepository — new filters', () => {
  let store: MemoryStore;
  let repo: InMemoryConversationRepository;
  const organizationId = 'org-1';

  beforeEach(async () => {
    store = new MemoryStore();
    repo = new InMemoryConversationRepository(store);

    await repo.create({
      organizationId,
      clientId: 'client-1',
      domainId: null,
      mailboxId: 'mailbox-1',
      emailThreadId: 'thread-1',
      contactEmail: 'a@example.com',
      contactName: 'Ana',
      sequenceId: 'sequence-1',
      origin: 'LEGACY_SEQUENCE',
      subject: 'Hola',
      isUnread: true,
      lastMessageAt: new Date('2026-01-10T00:00:00.000Z'),
    });
    await repo.create({
      organizationId,
      clientId: 'client-1',
      domainId: null,
      mailboxId: 'mailbox-1',
      emailThreadId: 'thread-2',
      contactEmail: 'b@example.com',
      contactName: 'Bruno',
      sequenceId: 'sequence-2',
      origin: 'LEGACY_SEQUENCE',
      subject: 'Seguimiento',
      isUnread: false,
      lastMessageAt: new Date('2026-02-20T00:00:00.000Z'),
    });
  });

  it('filters by sequenceId', async () => {
    const results = await repo.findAll(organizationId, { sequenceId: 'sequence-1' });
    expect(results).toHaveLength(1);
    expect(results[0].emailThreadId).toBe('thread-1');
  });

  it('filters by dateFrom (inclusive)', async () => {
    const results = await repo.findAll(organizationId, { dateFrom: '2026-02-01T00:00:00.000Z' });
    expect(results).toHaveLength(1);
    expect(results[0].emailThreadId).toBe('thread-2');
  });

  it('filters by dateTo (inclusive)', async () => {
    const results = await repo.findAll(organizationId, { dateTo: '2026-01-31T00:00:00.000Z' });
    expect(results).toHaveLength(1);
    expect(results[0].emailThreadId).toBe('thread-1');
  });

  it('filters by dateFrom and dateTo together as a range', async () => {
    const results = await repo.findAll(organizationId, {
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-01-31T00:00:00.000Z',
    });
    expect(results).toHaveLength(1);
    expect(results[0].emailThreadId).toBe('thread-1');
  });

  it('returns nothing when sequenceId matches no conversation', async () => {
    const results = await repo.findAll(organizationId, { sequenceId: 'sequence-does-not-exist' });
    expect(results).toHaveLength(0);
  });

  describe('§7 — responseOutcome filter', () => {
    beforeEach(async () => {
      const all = await repo.findAll(organizationId);
      const thread1 = all.find((c) => c.emailThreadId === 'thread-1')!;
      await repo.update(thread1.id, { responseOutcome: 'INTERESTED' });
      // thread-2 stays unclassified (responseOutcome === null)
    });

    it('filters by a specific outcome', async () => {
      const results = await repo.findAll(organizationId, { responseOutcome: 'INTERESTED' });
      expect(results).toHaveLength(1);
      expect(results[0].emailThreadId).toBe('thread-1');
    });

    it('filters by UNCLASSIFIED, matching only conversations with no outcome', async () => {
      const results = await repo.findAll(organizationId, { responseOutcome: 'UNCLASSIFIED' });
      expect(results).toHaveLength(1);
      expect(results[0].emailThreadId).toBe('thread-2');
    });

    it('returns everything when no responseOutcome filter is given', async () => {
      const results = await repo.findAll(organizationId, {});
      expect(results).toHaveLength(2);
    });

    it('returns nothing for an outcome no conversation has', async () => {
      const results = await repo.findAll(organizationId, { responseOutcome: 'DO_NOT_CONTACT' });
      expect(results).toHaveLength(0);
    });
  });

  describe('conversations of a revoked/deleted mailbox are hidden everywhere', () => {
    it('findAll excludes conversations whose mailbox is REVOKED', async () => {
      store.mailboxes.set('mailbox-1', buildMailbox({ linkStatus: 'REVOKED' }));

      const results = await repo.findAll(organizationId);

      expect(results).toHaveLength(0);
    });

    it('findAll excludes conversations whose mailbox is soft-deleted', async () => {
      store.mailboxes.set('mailbox-1', buildMailbox({ deletedAt: new Date() }));

      const results = await repo.findAll(organizationId);

      expect(results).toHaveLength(0);
    });

    it('findAll still returns conversations for a mailbox that is merely UNLINK_REQUESTED (not yet REVOKED)', async () => {
      store.mailboxes.set('mailbox-1', buildMailbox({ linkStatus: 'UNLINK_REQUESTED' }));

      const results = await repo.findAll(organizationId);

      expect(results).toHaveLength(2);
    });

    it('findById returns null (never the row) for a conversation of a REVOKED mailbox — a direct URL must 404', async () => {
      const [existing] = await repo.findAll(organizationId);
      store.mailboxes.set('mailbox-1', buildMailbox({ linkStatus: 'REVOKED' }));

      const found = await repo.findById(existing.id);

      expect(found).toBeNull();
    });

    it('findByMailboxAndThread returns null for a REVOKED mailbox', async () => {
      store.mailboxes.set('mailbox-1', buildMailbox({ linkStatus: 'REVOKED' }));

      const found = await repo.findByMailboxAndThread('mailbox-1', 'thread-1');

      expect(found).toBeNull();
    });

    it('a mailbox that is ACTIVE keeps its conversations fully visible', async () => {
      store.mailboxes.set('mailbox-1', buildMailbox({ linkStatus: 'ACTIVE' }));

      const results = await repo.findAll(organizationId);

      expect(results).toHaveLength(2);
    });
  });
});
