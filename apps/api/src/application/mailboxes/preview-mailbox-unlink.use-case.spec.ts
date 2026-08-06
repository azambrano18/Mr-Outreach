import { NotFoundException } from '@nestjs/common';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { UserRepository } from '../../domain/user/user.repository';
import { PreviewMailboxUnlinkUseCase } from './preview-mailbox-unlink.use-case';

describe('PreviewMailboxUnlinkUseCase', () => {
  let mailboxes: jest.Mocked<Pick<MailboxRepository, 'findById'>>;
  let assignments: jest.Mocked<Pick<MailboxAssignmentRepository, 'findByMailbox'>>;
  let users: jest.Mocked<Pick<UserRepository, 'findById'>>;
  let managedClients: jest.Mocked<Pick<ManagedClientRepository, 'findById'>>;
  let domains: jest.Mocked<Pick<DomainRepository, 'findById'>>;
  let conversations: jest.Mocked<Pick<ConversationRepository, 'findAll'>>;
  let sequenceTemplates: jest.Mocked<Pick<SequenceTemplateRepository, 'findByMailbox'>>;
  let sequenceExecutions: jest.Mocked<Pick<SequenceExecutionRepository, 'findAllByOrganization'>>;
  let scheduledEmails: jest.Mocked<Pick<ScheduledEmailRepository, 'findAll'>>;
  let useCase: PreviewMailboxUnlinkUseCase;

  const orgId = 'org_1';
  const mailbox = {
    id: 'mailbox_1',
    organizationId: orgId,
    email: 'ventas@example.com',
    clientId: 'client_1',
    domainId: 'domain_1',
    linkSource: 'SERVER_TOKEN',
    linkStatus: 'ACTIVE',
  };

  const primaryUser = { id: 'exec_1', name: 'Ana Gómez', firstName: 'Ana', lastName: 'Gómez', email: 'ana@example.com' };
  const secondaryUser = { id: 'exec_2', name: 'Beto Ruiz', firstName: 'Beto', lastName: 'Ruiz', email: 'beto@example.com' };

  beforeEach(() => {
    mailboxes = { findById: jest.fn().mockResolvedValue(mailbox) };
    assignments = { findByMailbox: jest.fn().mockResolvedValue([]) };
    users = {
      findById: jest.fn().mockImplementation(async (id: string) => {
        if (id === 'exec_1') return primaryUser;
        if (id === 'exec_2') return secondaryUser;
        return null;
      }),
    };
    managedClients = { findById: jest.fn().mockResolvedValue({ id: 'client_1', name: 'Cliente Uno' }) };
    domains = { findById: jest.fn().mockResolvedValue({ id: 'domain_1', domainName: 'cliente-uno.test' }) };
    conversations = { findAll: jest.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]) };
    sequenceTemplates = { findByMailbox: jest.fn().mockResolvedValue([{ id: 't1' }]) };
    sequenceExecutions = { findAllByOrganization: jest.fn().mockResolvedValue([]) };
    scheduledEmails = { findAll: jest.fn().mockResolvedValue([]) };

    useCase = new PreviewMailboxUnlinkUseCase(
      mailboxes as never,
      assignments as never,
      users as never,
      managedClients as never,
      domains as never,
      conversations as never,
      sequenceTemplates as never,
      sequenceExecutions as never,
      scheduledEmails as never,
    );
  });

  it('preflight with no assignments — canUnlink true, no executives, assignmentsToRemove 0', async () => {
    const preview = await useCase.execute(orgId, 'mailbox_1');

    expect(preview.canUnlink).toBe(true);
    expect(preview.blockingReasons).toEqual([]);
    expect(preview.primaryExecutive).toBeNull();
    expect(preview.secondaryExecutives).toEqual([]);
    expect(preview.assignmentsToRemove).toBe(0);
    expect(preview.conversationCount).toBe(2);
    expect(preview.templateCount).toBe(1);
    expect(preview.clientName).toBe('Cliente Uno');
    expect(preview.domainName).toBe('cliente-uno.test');
  });

  it('preflight with a primary executive only', async () => {
    assignments.findByMailbox.mockResolvedValue([{ id: 'a1', mailboxId: 'mailbox_1', userId: 'exec_1', role: 'PRIMARY' }] as never);

    const preview = await useCase.execute(orgId, 'mailbox_1');

    expect(preview.primaryExecutive).toEqual({ id: 'exec_1', name: 'Ana Gómez', email: 'ana@example.com' });
    expect(preview.secondaryExecutives).toEqual([]);
    expect(preview.assignmentsToRemove).toBe(1);
    expect(preview.canUnlink).toBe(true);
  });

  it('preflight with a primary and secondary executives', async () => {
    assignments.findByMailbox.mockResolvedValue([
      { id: 'a1', mailboxId: 'mailbox_1', userId: 'exec_1', role: 'PRIMARY' },
      { id: 'a2', mailboxId: 'mailbox_1', userId: 'exec_2', role: 'SECONDARY' },
    ] as never);

    const preview = await useCase.execute(orgId, 'mailbox_1');

    expect(preview.primaryExecutive).toEqual({ id: 'exec_1', name: 'Ana Gómez', email: 'ana@example.com' });
    expect(preview.secondaryExecutives).toEqual([{ id: 'exec_2', name: 'Beto Ruiz', email: 'beto@example.com' }]);
    expect(preview.assignmentsToRemove).toBe(2);
  });

  it('preflight with an active Gestión — canUnlink false, with the exact blocking message', async () => {
    sequenceExecutions.findAllByOrganization.mockResolvedValue([
      { id: 'exec_run_1', mailboxId: 'mailbox_1', status: 'RUNNING' },
    ] as never);

    const preview = await useCase.execute(orgId, 'mailbox_1');

    expect(preview.canUnlink).toBe(false);
    expect(preview.activeManagements).toBe(1);
    expect(preview.blockingReasons).toContain(
      'No puedes desvincular esta cuenta porque tiene Gestiones activas. Pausa o detén las Gestiones antes de continuar.',
    );
  });

  it('a Gestión on a different mailbox never blocks this preview', async () => {
    sequenceExecutions.findAllByOrganization.mockResolvedValue([
      { id: 'exec_run_1', mailboxId: 'some-other-mailbox', status: 'RUNNING' },
    ] as never);

    const preview = await useCase.execute(orgId, 'mailbox_1');

    expect(preview.canUnlink).toBe(true);
    expect(preview.activeManagements).toBe(0);
  });

  it('counts only cancellable/pending jobs, never sent/failed/cancelled ones', async () => {
    scheduledEmails.findAll.mockResolvedValue([
      { id: 'e1', status: 'PENDING' },
      { id: 'e2', status: 'SCHEDULED' },
      { id: 'e3', status: 'SENT' },
      { id: 'e4', status: 'CANCELLED' },
    ] as never);

    const preview = await useCase.execute(orgId, 'mailbox_1');

    expect(preview.pendingJobs).toBe(2);
  });

  it('flags a LEGACY_LOCAL mailbox as not eligible for unlink', async () => {
    mailboxes.findById.mockResolvedValue({ ...mailbox, linkSource: 'LEGACY_LOCAL' } as never);

    const preview = await useCase.execute(orgId, 'mailbox_1');

    expect(preview.canUnlink).toBe(false);
    expect(preview.blockingReasons).toContain('Esta cuenta no está vinculada por token; no admite desvinculación.');
  });

  it('flags an already-REVOKED mailbox as not eligible, but still reports residual assignments to remove', async () => {
    mailboxes.findById.mockResolvedValue({ ...mailbox, linkStatus: 'REVOKED' } as never);
    assignments.findByMailbox.mockResolvedValue([{ id: 'a1', mailboxId: 'mailbox_1', userId: 'exec_1', role: 'PRIMARY' }] as never);

    const preview = await useCase.execute(orgId, 'mailbox_1');

    expect(preview.canUnlink).toBe(false);
    expect(preview.blockingReasons).toContain('La cuenta ya está desvinculada.');
    expect(preview.assignmentsToRemove).toBe(1);
  });

  it('404s for a mailbox in a different organization', async () => {
    mailboxes.findById.mockResolvedValue({ ...mailbox, organizationId: 'org_2' } as never);

    await expect(useCase.execute(orgId, 'mailbox_1')).rejects.toThrow(NotFoundException);
  });
});
