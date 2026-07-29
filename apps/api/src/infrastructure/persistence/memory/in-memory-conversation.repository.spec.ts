import { InMemoryConversationRepository } from './in-memory-conversation.repository';
import { MemoryStore } from './memory-store';

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
});
