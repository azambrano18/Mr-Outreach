import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { MailboxAssignment } from '../../domain/mailbox-assignment/mailbox-assignment.entity';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { Sequence } from '../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SequenceStep } from '../../domain/sequence/sequence-step.entity';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { Signature } from '../../domain/signature/signature.entity';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { SequenceEligibilityService } from './sequence-eligibility.service';
import { SequenceStepsService } from './sequence-steps.service';
import { SequencesService } from './sequences.service';

describe('SequencesService', () => {
  let sequences: jest.Mocked<SequenceRepository>;
  let steps: jest.Mocked<SequenceStepRepository>;
  let mailboxes: jest.Mocked<MailboxRepository>;
  let assignments: jest.Mocked<MailboxAssignmentRepository>;
  let signatures: jest.Mocked<SignatureRepository>;
  let signatureVersions: jest.Mocked<SignatureVersionRepository>;
  let users: jest.Mocked<UserRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let clientExecutiveAssignments: jest.Mocked<ClientExecutiveAssignmentRepository>;
  let sequenceSteps: jest.Mocked<Pick<SequenceStepsService, 'create'>>;
  let eligibility: jest.Mocked<Pick<SequenceEligibilityService, 'verify'>>;
  let service: SequencesService;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';

  const buildSequence = (overrides: Partial<Sequence> = {}): Sequence => ({
    id: 'sequence_1',
    organizationId: orgId,
    executiveId: 'exec_1',
    mailboxId: null,
    clientId: null,
    name: 'Prospección',
    description: null,
    status: 'DRAFT',
    timezone: 'America/Santiago',
    schedule: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], windows: [{ start: '09:00', end: '18:00' }] },
    policies: {
      stopOnReply: true,
      stopOnHardBounce: true,
      stopOnUnsubscribe: true,
      prioritizeFollowUps: true,
    },
    managementDate: null,
    stepPolicy: 'FLEXIBLE',
    publishStatus: null,
    effectiveStartAt: null,
    sequenceVersion: 0,
    lastPublishedAt: null,
    lastPublishCommandId: null,
    createdBy: 'admin_1',
    updatedBy: 'admin_1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  });

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'exec_1',
      organizationId: orgId,
      firstName: 'Ejecutivo',
      lastName: 'Uno',
      email: 'ejecutivo@example.com',
      status: 'ACTIVE',
      ...overrides,
    }) as User;

  const buildMailbox = (overrides: Partial<Mailbox> = {}): Mailbox =>
    ({
      id: 'mailbox_1',
      organizationId: orgId,
      email: 'ventas@example.com',
      fromName: 'Ventas',
      status: 'ACTIVE',
      connectionStatus: 'CONNECTED',
      ...overrides,
    }) as Mailbox;

  const buildAssignment = (overrides: Partial<MailboxAssignment> = {}): MailboxAssignment => ({
    id: 'assignment_1',
    organizationId: orgId,
    mailboxId: 'mailbox_1',
    userId: 'exec_1',
    role: 'PRIMARY',
    assignedBy: 'admin_1',
    assignedAt: new Date(),
    ...overrides,
  });

  const buildSignature = (overrides: Partial<Signature> = {}): Signature => ({
    id: 'signature_1',
    organizationId: orgId,
    mailboxId: 'mailbox_1',
    status: 'ACTIVE',
    activeVersionId: 'version_1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const buildStep = (overrides: Partial<SequenceStep> = {}): SequenceStep =>
    ({
      id: 'step_1',
      sequenceId: 'sequence_1',
      position: 1,
      name: 'Step 1',
      subject: 'Asunto',
      htmlBody: '<p>Cuerpo</p>',
      ...overrides,
    }) as SequenceStep;

  beforeEach(() => {
    sequences = {
      findById: jest.fn(),
      findByExecutive: jest.fn(),
      findByClient: jest.fn(),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      conditionalUpdatePublishStatus: jest.fn(),
    };
    steps = {
      findById: jest.fn(),
      findBySequence: jest.fn().mockResolvedValue([]),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    mailboxes = {
      findById: jest.fn(),
      findByIdIncludingDeleted: jest.fn(),
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
      findByMailbox: jest.fn().mockResolvedValue([]),
      findByUser: jest.fn(),
      findAllByOrganization: jest.fn().mockResolvedValue([]),
    };
    signatures = {
      findById: jest.fn(),
      findByMailbox: jest.fn(),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    signatureVersions = { create: jest.fn(), findById: jest.fn(), findBySignature: jest.fn() };
    users = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByEmailAnyOrganization: jest.fn(),
      findByEmailIncludingDeleted: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    clientExecutiveAssignments = {
      upsert: jest.fn(),
      remove: jest.fn(),
      findByClient: jest.fn(),
      findByUser: jest.fn().mockResolvedValue([]),
      ensureDerivedVisibility: jest.fn(),
      removeDerivedVisibilityIfPresent: jest.fn(),
    };
    sequenceSteps = { create: jest.fn() };
    eligibility = { verify: jest.fn() };

    service = new SequencesService(
      sequences,
      steps,
      mailboxes,
      assignments,
      signatures,
      signatureVersions,
      users,
      auditLogs,
      clientExecutiveAssignments,
      sequenceSteps as unknown as SequenceStepsService,
      eligibility as unknown as SequenceEligibilityService,
    );
  });

  describe('create', () => {
    it('creates a DRAFT sequence for an active, owned executive', async () => {
      users.findById.mockResolvedValue(buildUser());
      sequences.create.mockResolvedValue(buildSequence());

      const result = await service.create(
        orgId,
        'exec_1',
        { name: 'Prospección', timezone: 'America/Santiago' },
        'admin_1',
      );

      expect(result.status).toBe('DRAFT');
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sequence.create' }),
      );
    });

    it('rejects an inactive executive', async () => {
      users.findById.mockResolvedValue(buildUser({ status: 'INACTIVE' }));

      await expect(
        service.create(orgId, 'exec_1', { name: 'X', timezone: 'UTC' }, 'admin_1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an executive in a different organization (never 403)', async () => {
      users.findById.mockResolvedValue(buildUser({ organizationId: otherOrgId }));

      await expect(
        service.create(orgId, 'exec_1', { name: 'X', timezone: 'UTC' }, 'admin_1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update — sender account selection', () => {
    it('accepts a mailbox assigned to the sequence executive', async () => {
      sequences.findById.mockResolvedValue(buildSequence());
      mailboxes.findById.mockResolvedValue(buildMailbox());
      assignments.findByMailbox.mockResolvedValue([buildAssignment({ userId: 'exec_1' })]);
      sequences.update.mockResolvedValue(buildSequence({ mailboxId: 'mailbox_1' }));

      const result = await service.update(
        orgId,
        'sequence_1',
        { mailboxId: 'mailbox_1' },
        'admin_1',
      );

      expect(result.mailboxId).toBe('mailbox_1');
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sequence.change_account' }),
      );
    });

    it('rejects a mailbox not assigned to the sequence executive', async () => {
      sequences.findById.mockResolvedValue(buildSequence());
      mailboxes.findById.mockResolvedValue(buildMailbox());
      assignments.findByMailbox.mockResolvedValue([buildAssignment({ userId: 'someone_else' })]);

      await expect(
        service.update(orgId, 'sequence_1', { mailboxId: 'mailbox_1' }, 'admin_1'),
      ).rejects.toThrow(BadRequestException);
      expect(sequences.update).not.toHaveBeenCalled();
    });

    it('allows clearing the sender account with null, without validating anything', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ mailboxId: 'mailbox_1' }));
      sequences.update.mockResolvedValue(buildSequence({ mailboxId: null }));

      await service.update(orgId, 'sequence_1', { mailboxId: null }, 'admin_1');

      expect(mailboxes.findById).not.toHaveBeenCalled();
      expect(sequences.update).toHaveBeenCalledWith(
        'sequence_1',
        expect.objectContaining({ mailboxId: null }),
      );
    });

    it('throws NotFoundException for a sequence in a different organization', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ organizationId: otherOrgId }));

      await expect(service.update(orgId, 'sequence_1', { name: 'X' }, 'admin_1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('duplicate', () => {
    it('copies the sequence and all of its steps', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ mailboxId: 'mailbox_1' }));
      steps.findBySequence.mockResolvedValueOnce([
        buildStep(),
        buildStep({ id: 'step_2', position: 2 }),
      ]);
      sequences.create.mockResolvedValue(
        buildSequence({ id: 'sequence_2', name: 'Prospección (copia)' }),
      );
      sequences.update.mockResolvedValue(
        buildSequence({ id: 'sequence_2', mailboxId: 'mailbox_1' }),
      );
      steps.create.mockResolvedValue(buildStep());
      sequences.findById.mockResolvedValueOnce(buildSequence({ mailboxId: 'mailbox_1' }));
      sequences.findById.mockResolvedValue(
        buildSequence({ id: 'sequence_2', name: 'Prospección (copia)' }),
      );
      steps.findBySequence.mockResolvedValue([]);

      await service.duplicate(orgId, 'sequence_1', 'admin_1');

      expect(steps.create).toHaveBeenCalledTimes(2);
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sequence.duplicate' }),
      );
    });
  });

  describe('pause / resume / archive / restore', () => {
    it('pauses a DRAFT sequence', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ status: 'DRAFT' }));
      sequences.update.mockResolvedValue(buildSequence({ status: 'PAUSED' }));

      const result = await service.pause(orgId, 'sequence_1', 'admin_1');

      expect(result.status).toBe('PAUSED');
    });

    it('rejects pausing a sequence that is not DRAFT', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ status: 'ARCHIVED' }));

      await expect(service.pause(orgId, 'sequence_1', 'admin_1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('resumes a PAUSED sequence back to DRAFT', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ status: 'PAUSED' }));
      sequences.update.mockResolvedValue(buildSequence({ status: 'DRAFT' }));

      const result = await service.resume(orgId, 'sequence_1', 'admin_1');

      expect(result.status).toBe('DRAFT');
    });

    it('archives a DRAFT sequence and rejects archiving an already-archived one', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ status: 'DRAFT' }));
      sequences.update.mockResolvedValue(buildSequence({ status: 'ARCHIVED' }));
      const result = await service.archive(orgId, 'sequence_1', 'admin_1');
      expect(result.status).toBe('ARCHIVED');

      sequences.findById.mockResolvedValue(buildSequence({ status: 'ARCHIVED' }));
      await expect(service.archive(orgId, 'sequence_1', 'admin_1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('restores an ARCHIVED sequence back to DRAFT', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ status: 'ARCHIVED' }));
      sequences.update.mockResolvedValue(buildSequence({ status: 'DRAFT' }));

      const result = await service.restore(orgId, 'sequence_1', 'admin_1');

      expect(result.status).toBe('DRAFT');
    });
  });

  describe('requireOwnedByExecutive', () => {
    it('returns the summary when the sequence belongs to that executive', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ executiveId: 'exec_1' }));

      const result = await service.requireOwnedByExecutive(orgId, 'sequence_1', 'exec_1');

      expect(result.id).toBe('sequence_1');
    });

    it('throws NotFoundException (not ForbiddenException) when it belongs to a different executive', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ executiveId: 'exec_1' }));

      await expect(service.requireOwnedByExecutive(orgId, 'sequence_1', 'exec_2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for a sequence in a different organization', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ organizationId: otherOrgId }));

      await expect(service.requireOwnedByExecutive(orgId, 'sequence_1', 'exec_1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes, forces status to ARCHIVED, and records the previous status in the audit entry', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ status: 'DRAFT' }));
      sequences.update.mockResolvedValue(
        buildSequence({ status: 'ARCHIVED', deletedAt: new Date() }),
      );

      const result = await service.remove(orgId, 'sequence_1', 'admin_1');

      expect(sequences.update).toHaveBeenCalledWith(
        'sequence_1',
        expect.objectContaining({ status: 'ARCHIVED', deletedAt: expect.any(Date) }),
      );
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'sequence.delete',
          metadata: expect.objectContaining({ previousStatus: 'DRAFT', cancelledJobs: 0 }),
        }),
      );
      expect(result.previousStatus).toBe('DRAFT');
      expect(result.cancelledJobs).toBe(0);
    });

    it('throws NotFoundException for a sequence in a different organization', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ organizationId: otherOrgId }));

      await expect(service.remove(orgId, 'sequence_1', 'admin_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(sequences.update).not.toHaveBeenCalled();
    });

    it('is idempotent: a sequence already soft-deleted is invisible to findById, so a second call 404s instead of double-recording', async () => {
      sequences.findById.mockResolvedValueOnce(buildSequence()).mockResolvedValueOnce(null);
      sequences.update.mockResolvedValue(buildSequence({ status: 'ARCHIVED' }));

      await service.remove(orgId, 'sequence_1', 'admin_1');
      await expect(service.remove(orgId, 'sequence_1', 'admin_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(sequences.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('getReadiness', () => {
    it('flags a missing sender account and reports prospects/calendar as pending features', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ mailboxId: null }));
      steps.findBySequence.mockResolvedValue([]);

      const readiness = await service.getReadiness(orgId, 'sequence_1');

      expect(readiness.account.ok).toBe(false);
      expect(readiness.account.issues[0]).toContain('cuenta remitente');
      expect(readiness.steps.ok).toBe(false);
      expect(readiness.prospects.status).toBe('PENDING_FEATURE');
      expect(readiness.calendar.status).toBe('PENDING_FEATURE');
      expect(readiness.overallReady).toBe(false);
    });

    it('flags a mailbox with no active signature', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ mailboxId: 'mailbox_1' }));
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(null);
      steps.findBySequence.mockResolvedValue([buildStep()]);

      const readiness = await service.getReadiness(orgId, 'sequence_1');

      expect(readiness.account.ok).toBe(false);
      expect(readiness.account.issues.some((issue) => issue.includes('firma activa'))).toBe(true);
    });

    it('passes account and steps checks when everything is configured, still gating overallReady on account+steps only', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ mailboxId: 'mailbox_1' }));
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature());
      signatureVersions.findById.mockResolvedValue({
        id: 'version_1',
        signatureId: 'signature_1',
        versionNumber: 1,
        htmlContent: '<p>Firma</p>',
        plainTextContent: 'Firma',
        createdAt: new Date(),
        createdBy: 'admin_1',
      });
      steps.findBySequence.mockResolvedValue([buildStep()]);

      const readiness = await service.getReadiness(orgId, 'sequence_1');

      expect(readiness.account.ok).toBe(true);
      expect(readiness.steps.ok).toBe(true);
      expect(readiness.overallReady).toBe(true);
    });

    it('flags a step missing subject or body', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ mailboxId: null }));
      steps.findBySequence.mockResolvedValue([buildStep({ subject: '', htmlBody: '' })]);

      const readiness = await service.getReadiness(orgId, 'sequence_1');

      expect(readiness.steps.ok).toBe(false);
      expect(readiness.steps.issues.length).toBeGreaterThanOrEqual(2);
    });
  });
});
