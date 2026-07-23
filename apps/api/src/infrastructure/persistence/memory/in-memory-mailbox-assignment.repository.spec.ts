import { InMemoryMailboxAssignmentRepository } from './in-memory-mailbox-assignment.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryMailboxAssignmentRepository', () => {
  it('assigns a user to a mailbox with a role and lists it both ways', async () => {
    const repo = new InMemoryMailboxAssignmentRepository(new MemoryStore());

    await repo.upsert({
      organizationId: 'org_1',
      mailboxId: 'mailbox_1',
      userId: 'user_1',
      role: 'PRIMARY',
      assignedBy: 'admin_1',
    });

    const byMailbox = await repo.findByMailbox('mailbox_1');
    expect(byMailbox).toHaveLength(1);
    expect(byMailbox[0]).toMatchObject({ userId: 'user_1', role: 'PRIMARY' });

    const byUser = await repo.findByUser('user_1');
    expect(byUser).toHaveLength(1);
    expect(byUser[0]).toMatchObject({ mailboxId: 'mailbox_1' });
  });

  it('supports multiple executives per mailbox and multiple mailboxes per executive', async () => {
    const repo = new InMemoryMailboxAssignmentRepository(new MemoryStore());

    await repo.upsert({
      organizationId: 'org_1',
      mailboxId: 'mailbox_1',
      userId: 'user_1',
      role: 'PRIMARY',
      assignedBy: 'admin_1',
    });
    await repo.upsert({
      organizationId: 'org_1',
      mailboxId: 'mailbox_1',
      userId: 'user_2',
      role: 'SECONDARY',
      assignedBy: 'admin_1',
    });
    await repo.upsert({
      organizationId: 'org_1',
      mailboxId: 'mailbox_2',
      userId: 'user_1',
      role: 'PRIMARY',
      assignedBy: 'admin_1',
    });

    expect((await repo.findByMailbox('mailbox_1')).map((a) => a.userId)).toEqual(
      expect.arrayContaining(['user_1', 'user_2']),
    );
    expect((await repo.findByUser('user_1')).map((a) => a.mailboxId)).toEqual(
      expect.arrayContaining(['mailbox_1', 'mailbox_2']),
    );
  });

  it('removing an assignment removes only that pair', async () => {
    const repo = new InMemoryMailboxAssignmentRepository(new MemoryStore());

    await repo.upsert({
      organizationId: 'org_1',
      mailboxId: 'mailbox_1',
      userId: 'user_1',
      role: 'PRIMARY',
      assignedBy: 'admin_1',
    });
    await repo.upsert({
      organizationId: 'org_1',
      mailboxId: 'mailbox_1',
      userId: 'user_2',
      role: 'SECONDARY',
      assignedBy: 'admin_1',
    });

    await repo.remove('mailbox_1', 'user_1');

    expect((await repo.findByMailbox('mailbox_1')).map((a) => a.userId)).toEqual(['user_2']);
  });

  it('upserting the same pair again changes its role instead of duplicating it', async () => {
    const repo = new InMemoryMailboxAssignmentRepository(new MemoryStore());

    await repo.upsert({
      organizationId: 'org_1',
      mailboxId: 'mailbox_1',
      userId: 'user_1',
      role: 'SECONDARY',
      assignedBy: 'admin_1',
    });
    await repo.upsert({
      organizationId: 'org_1',
      mailboxId: 'mailbox_1',
      userId: 'user_1',
      role: 'PRIMARY',
      assignedBy: 'admin_2',
    });

    const byMailbox = await repo.findByMailbox('mailbox_1');
    expect(byMailbox).toHaveLength(1);
    expect(byMailbox[0]).toMatchObject({ role: 'PRIMARY', assignedBy: 'admin_2' });
  });
});
