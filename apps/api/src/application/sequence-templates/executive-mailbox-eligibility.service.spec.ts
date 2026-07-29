import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { MailboxMotorPort } from '../../domain/mailbox-motor/mailbox-motor-port';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { ExecutiveMailboxEligibilityService } from './executive-mailbox-eligibility.service';

describe('ExecutiveMailboxEligibilityService', () => {
  let mailboxes: jest.Mocked<MailboxRepository>;
  let assignments: jest.Mocked<MailboxAssignmentRepository>;
  let motor: jest.Mocked<Pick<MailboxMotorPort, 'getMailboxStatus'>>;
  let service: ExecutiveMailboxEligibilityService;

  const orgId = 'org_1';
  const executiveId = 'exec_1';
  const mailboxId = 'mailbox_1';

  function legacyMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
    return {
      id: mailboxId,
      organizationId: orgId,
      status: 'ACTIVE',
      linkStatus: 'ACTIVE',
      linkSource: 'LEGACY_LOCAL',
      serverMailboxId: null,
      ...overrides,
    } as Mailbox;
  }

  beforeEach(() => {
    mailboxes = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByServerMailboxId: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      createLinked: jest.fn(),
      update: jest.fn(),
    };
    assignments = {
      upsert: jest.fn(),
      remove: jest.fn(),
      findByMailbox: jest.fn(),
      findByUser: jest.fn(),
      findAllByOrganization: jest.fn(),
    };
    motor = { getMailboxStatus: jest.fn() };
    service = new ExecutiveMailboxEligibilityService(mailboxes, assignments, motor as unknown as MailboxMotorPort);
  });

  it('rejects when the mailbox does not exist', async () => {
    mailboxes.findById.mockResolvedValue(null);
    await expect(service.requireEligible(orgId, executiveId, mailboxId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when the mailbox belongs to a different organization (tenant isolation)', async () => {
    mailboxes.findById.mockResolvedValue(legacyMailbox({ organizationId: 'other_org' }));
    await expect(service.requireEligible(orgId, executiveId, mailboxId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when the executive has no assignment on the mailbox', async () => {
    mailboxes.findById.mockResolvedValue(legacyMailbox());
    assignments.findByMailbox.mockResolvedValue([{ id: 'a1', organizationId: orgId, mailboxId, userId: 'someone_else', role: 'PRIMARY', assignedBy: 'admin', assignedAt: new Date() }]);
    await expect(service.requireEligible(orgId, executiveId, mailboxId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts a SECONDARY assignment, not only PRIMARY', async () => {
    mailboxes.findById.mockResolvedValue(legacyMailbox());
    assignments.findByMailbox.mockResolvedValue([{ id: 'a1', organizationId: orgId, mailboxId, userId: executiveId, role: 'SECONDARY', assignedBy: 'admin', assignedAt: new Date() }]);
    await expect(service.requireEligible(orgId, executiveId, mailboxId)).resolves.toBeTruthy();
  });

  it('rejects a locally inactive mailbox', async () => {
    mailboxes.findById.mockResolvedValue(legacyMailbox({ status: 'INACTIVE' }));
    assignments.findByMailbox.mockResolvedValue([{ id: 'a1', organizationId: orgId, mailboxId, userId: executiveId, role: 'PRIMARY', assignedBy: 'admin', assignedAt: new Date() }]);
    await expect(service.requireEligible(orgId, executiveId, mailboxId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a revoked mailbox', async () => {
    mailboxes.findById.mockResolvedValue(legacyMailbox({ linkStatus: 'REVOKED' }));
    assignments.findByMailbox.mockResolvedValue([{ id: 'a1', organizationId: orgId, mailboxId, userId: executiveId, role: 'PRIMARY', assignedBy: 'admin', assignedAt: new Date() }]);
    await expect(service.requireEligible(orgId, executiveId, mailboxId)).rejects.toBeInstanceOf(ConflictException);
  });

  describe('SERVER_TOKEN mailbox — live fail-closed check', () => {
    function serverMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
      return legacyMailbox({ linkSource: 'SERVER_TOKEN', serverMailboxId: 'srv_1', ...overrides });
    }

    beforeEach(() => {
      assignments.findByMailbox.mockResolvedValue([{ id: 'a1', organizationId: orgId, mailboxId, userId: executiveId, role: 'PRIMARY', assignedBy: 'admin', assignedAt: new Date() }]);
      mailboxes.update.mockImplementation(async (_id, input) => ({ ...serverMailbox(), ...input }) as Mailbox);
    });

    it('propagates ServiceUnavailableException when the motor cannot be reached (fail-closed)', async () => {
      mailboxes.findById.mockResolvedValue(serverMailbox());
      motor.getMailboxStatus.mockRejectedValue(new ServiceUnavailableException('El servidor motor no está disponible.'));
      await expect(service.requireEligible(orgId, executiveId, mailboxId)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('rejects when the motor reports the mailbox is not ACTIVE', async () => {
      mailboxes.findById.mockResolvedValue(serverMailbox());
      motor.getMailboxStatus.mockResolvedValue({ serverMailboxId: 'srv_1', linkStatus: 'REVOKED', technicalStatus: 'CONNECTED', canSend: true, checkedAt: new Date() });
      await expect(service.requireEligible(orgId, executiveId, mailboxId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when the motor reports canSend=false', async () => {
      mailboxes.findById.mockResolvedValue(serverMailbox());
      motor.getMailboxStatus.mockResolvedValue({ serverMailboxId: 'srv_1', linkStatus: 'ACTIVE', technicalStatus: 'CONNECTED', canSend: false, checkedAt: new Date() });
      await expect(service.requireEligible(orgId, executiveId, mailboxId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when the motor reports a non-CONNECTED technical status', async () => {
      mailboxes.findById.mockResolvedValue(serverMailbox());
      motor.getMailboxStatus.mockResolvedValue({ serverMailboxId: 'srv_1', linkStatus: 'ACTIVE', technicalStatus: 'DEGRADED', canSend: true, checkedAt: new Date() });
      await expect(service.requireEligible(orgId, executiveId, mailboxId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts and refreshes the snapshot when the motor reports a healthy, connected, sendable mailbox', async () => {
      mailboxes.findById.mockResolvedValue(serverMailbox());
      motor.getMailboxStatus.mockResolvedValue({ serverMailboxId: 'srv_1', linkStatus: 'ACTIVE', technicalStatus: 'CONNECTED', canSend: true, checkedAt: new Date() });
      await expect(service.requireEligible(orgId, executiveId, mailboxId)).resolves.toBeTruthy();
      expect(mailboxes.update).toHaveBeenCalledWith(
        mailboxId,
        expect.objectContaining({ linkStatus: 'ACTIVE', serverStatusSnapshot: 'CONNECTED', serverCanSendSnapshot: true }),
      );
    });
  });
});
