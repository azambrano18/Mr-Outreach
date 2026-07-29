import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MailboxProvisioningEventApplier } from './mailbox-provisioning-event-applier';

describe('MailboxProvisioningEventApplier', () => {
  let mailboxes: jest.Mocked<Pick<MailboxRepository, 'update'>>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let applier: MailboxProvisioningEventApplier;

  const orgId = 'org_1';
  const mailbox = { id: 'mb_1', organizationId: orgId };

  function event(eventType: string, payload: Record<string, unknown> = {}) {
    return { commandId: 'cmd_1', eventType, payload } as never;
  }

  beforeEach(() => {
    mailboxes = { update: jest.fn() };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    applier = new MailboxProvisioningEventApplier(
      mailboxes as unknown as MailboxRepository,
      auditLogs,
    );
  });

  it('MAILBOX_PROVISION_ACCEPTED: audits only, no status change', async () => {
    await applier.apply(orgId, mailbox, event('MAILBOX_PROVISION_ACCEPTED'), 'actor_1');
    expect(mailboxes.update).not.toHaveBeenCalled();
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'mailbox.provision_accepted' }));
  });

  it('MAILBOX_PROVISION_STARTED: sets PROVISIONING and audits', async () => {
    await applier.apply(orgId, mailbox, event('MAILBOX_PROVISION_STARTED'), 'actor_1');
    expect(mailboxes.update).toHaveBeenCalledWith('mb_1', { provisioningStatus: 'PROVISIONING' });
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'mailbox.provision_started' }));
  });

  it('MAILBOX_IMAP_VALIDATED: sets PARTIALLY_CONNECTED, no audit', async () => {
    await applier.apply(orgId, mailbox, event('MAILBOX_IMAP_VALIDATED'), 'actor_1');
    expect(mailboxes.update).toHaveBeenCalledWith('mb_1', { connectionStatus: 'PARTIALLY_CONNECTED' });
    expect(auditLogs.record).not.toHaveBeenCalled();
  });

  it('MAILBOX_SMTP_VALIDATED: sets CONNECTED, no audit', async () => {
    await applier.apply(orgId, mailbox, event('MAILBOX_SMTP_VALIDATED'), 'actor_1');
    expect(mailboxes.update).toHaveBeenCalledWith('mb_1', { connectionStatus: 'CONNECTED' });
    expect(auditLogs.record).not.toHaveBeenCalled();
  });

  it('MAILBOX_PROVISION_COMPLETED: sets PROVISIONED+CONNECTED and audits', async () => {
    await applier.apply(orgId, mailbox, event('MAILBOX_PROVISION_COMPLETED'), 'actor_1');
    expect(mailboxes.update).toHaveBeenCalledWith('mb_1', { provisioningStatus: 'PROVISIONED', connectionStatus: 'CONNECTED' });
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'mailbox.provision_completed' }));
  });

  it('MAILBOX_PROVISION_FAILED: sets PROVISION_FAILED+CONNECTION_ERROR, audits a sanitized reason', async () => {
    await applier.apply(orgId, mailbox, event('MAILBOX_PROVISION_FAILED', { message: 'TIMEOUT' }), 'actor_1');
    expect(mailboxes.update).toHaveBeenCalledWith('mb_1', { provisioningStatus: 'PROVISION_FAILED', connectionStatus: 'CONNECTION_ERROR' });
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mailbox.provision_failed', metadata: expect.objectContaining({ reason: 'TIMEOUT' }) }),
    );
  });

  it('a repeated terminal event is idempotent — applying it again just re-applies the same state, never throws or double-counts business-meaningfully', async () => {
    await applier.apply(orgId, mailbox, event('MAILBOX_PROVISION_COMPLETED'), 'actor_1');
    await applier.apply(orgId, mailbox, event('MAILBOX_PROVISION_COMPLETED'), 'actor_1');
    expect(mailboxes.update).toHaveBeenCalledTimes(2);
    expect(auditLogs.record).toHaveBeenCalledTimes(2);
  });

  it('an unknown/unhandled event type is ignored in a controlled way — never throws', async () => {
    await expect(applier.apply(orgId, mailbox, event('SOME_UNMODELED_EVENT'), 'actor_1')).resolves.toBeUndefined();
    expect(mailboxes.update).not.toHaveBeenCalled();
    expect(auditLogs.record).not.toHaveBeenCalled();
  });

  it('refuses to act when the event/mailbox organizationId does not match the caller-provided organizationId', async () => {
    const otherOrgMailbox = { id: 'mb_1', organizationId: 'other_org' };
    await applier.apply(orgId, otherOrgMailbox, event('MAILBOX_PROVISION_COMPLETED'), 'actor_1');
    expect(mailboxes.update).not.toHaveBeenCalled();
    expect(auditLogs.record).not.toHaveBeenCalled();
  });
});
