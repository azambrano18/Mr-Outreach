import { InMemoryMailboxConnectionTestRepository } from './in-memory-mailbox-connection-test.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryMailboxConnectionTestRepository', () => {
  it('records an entry and returns it via findByMailbox', async () => {
    const repo = new InMemoryMailboxConnectionTestRepository(new MemoryStore());

    const recorded = await repo.record({
      organizationId: 'org_1',
      mailboxId: 'mailbox_1',
      status: 'CONNECTED',
      imapSuccess: true,
      smtpSuccess: true,
      message: 'Conexión exitosa a IMAP y SMTP.',
      technicalMessage: 'imap=ok smtp=ok',
      executedBy: 'user_1',
    });

    const history = await repo.findByMailbox('mailbox_1');

    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(recorded.id);
    expect(history[0].imapErrorCode).toBeNull();
  });

  it('scopes findByMailbox to the given mailbox and orders most recent first', async () => {
    const repo = new InMemoryMailboxConnectionTestRepository(new MemoryStore());

    await repo.record({
      organizationId: 'org_1',
      mailboxId: 'mailbox_1',
      status: 'CONNECTION_ERROR',
      imapSuccess: false,
      imapErrorCode: 'IMAP_TIMEOUT',
      smtpSuccess: false,
      smtpErrorCode: 'SMTP_TIMEOUT',
      message: 'No se pudo establecer conexión con el servidor de correo.',
      technicalMessage: 'imap=IMAP_TIMEOUT smtp=SMTP_TIMEOUT',
      executedBy: 'user_1',
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await repo.record({
      organizationId: 'org_1',
      mailboxId: 'mailbox_1',
      status: 'CONNECTED',
      imapSuccess: true,
      smtpSuccess: true,
      message: 'Conexión exitosa a IMAP y SMTP.',
      technicalMessage: 'imap=ok smtp=ok',
      executedBy: 'user_1',
    });
    await repo.record({
      organizationId: 'org_1',
      mailboxId: 'mailbox_2',
      status: 'CONNECTED',
      imapSuccess: true,
      smtpSuccess: true,
      message: 'Conexión exitosa a IMAP y SMTP.',
      technicalMessage: 'imap=ok smtp=ok',
      executedBy: 'user_1',
    });

    const history = await repo.findByMailbox('mailbox_1');

    expect(history).toHaveLength(2);
    expect(history[0].id).toBe(second.id);
  });
});
