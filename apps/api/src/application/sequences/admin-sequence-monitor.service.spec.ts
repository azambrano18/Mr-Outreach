import { NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ManagedClient } from '../../domain/client/managed-client.entity';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { ScheduledEmail } from '../../domain/scheduled-email/scheduled-email.entity';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceContact } from '../../domain/sequence-contact/sequence-contact.entity';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { Sequence } from '../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SequenceStep } from '../../domain/sequence/sequence-step.entity';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { SchedulingService } from '../scheduling/scheduling.service';
import { AdminSequenceMonitorService } from './admin-sequence-monitor.service';

describe('AdminSequenceMonitorService', () => {
  let sequences: jest.Mocked<SequenceRepository>;
  let steps: jest.Mocked<SequenceStepRepository>;
  let sequenceContacts: jest.Mocked<SequenceContactRepository>;
  let scheduledEmails: jest.Mocked<ScheduledEmailRepository>;
  let mailboxes: jest.Mocked<MailboxRepository>;
  let users: jest.Mocked<UserRepository>;
  let managedClients: jest.Mocked<ManagedClientRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let scheduling: jest.Mocked<Pick<SchedulingService, 'cancelFutureJobsForSequence'>>;
  let service: AdminSequenceMonitorService;

  const orgId = 'org_1';

  const buildSequence = (overrides: Partial<Sequence> = {}): Sequence =>
    ({
      id: 'sequence_1',
      organizationId: orgId,
      executiveId: 'exec_1',
      createdBy: 'admin_1',
      clientId: 'client_1',
      mailboxId: 'mailbox_1',
      name: 'Gestión_01082026',
      status: 'DRAFT',
      publishStatus: null,
      effectiveStartAt: null,
      createdAt: new Date('2026-08-01T10:00:00Z'),
      timezone: 'America/Santiago',
      managementDate: '2026-08-01',
      ...overrides,
    }) as Sequence;

  const buildStep = (overrides: Partial<SequenceStep> = {}): SequenceStep =>
    ({
      id: 'step_1',
      sequenceId: 'sequence_1',
      position: 1,
      name: 'Enviados_1',
      subject: 'Asunto',
      htmlHeader: null,
      htmlBody: '<p>Cuerpo</p>',
      ...overrides,
    }) as SequenceStep;

  const buildContact = (overrides: Partial<SequenceContact> = {}): SequenceContact =>
    ({
      id: 'contact_1',
      organizationId: orgId,
      sequenceId: 'sequence_1',
      status: 'ACTIVE',
      lastSentAt: null,
      repliedAt: null,
      stoppedAt: null,
      completedAt: null,
      stopReason: null,
      ...overrides,
    }) as SequenceContact;

  const buildEmail = (overrides: Partial<ScheduledEmail> = {}): ScheduledEmail =>
    ({
      id: 'email_1',
      organizationId: orgId,
      sequenceId: 'sequence_1',
      sequenceStepId: 'step_1',
      status: 'SENT',
      sentAt: new Date('2026-08-01T12:00:00Z'),
      subjectSnapshot: 'Asunto enviado',
      htmlBodySnapshot: '<p>Cuerpo enviado</p>',
      ...overrides,
    }) as ScheduledEmail;

  beforeEach(() => {
    sequences = {
      findById: jest.fn(),
      findByExecutive: jest.fn(),
      findByClient: jest.fn(),
      findAllByOrganization: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    };
    steps = {
      findById: jest.fn(),
      findBySequence: jest.fn().mockResolvedValue([]),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    sequenceContacts = {
      findById: jest.fn(),
      findBySequence: jest.fn().mockResolvedValue([]),
      findByContactAndSequence: jest.fn(),
      findByContact: jest.fn(),
      findAllByOrganization: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    };
    scheduledEmails = {
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findBySequenceContact: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    };
    mailboxes = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    };
    users = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByEmailAnyOrganization: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    };
    managedClients = {
      findById: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      findByCrmClientId: jest.fn(),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn().mockResolvedValue([]) };
    scheduling = { cancelFutureJobsForSequence: jest.fn().mockResolvedValue(0) };

    service = new AdminSequenceMonitorService(
      sequences,
      steps,
      sequenceContacts,
      scheduledEmails,
      mailboxes,
      users,
      managedClients,
      auditLogs,
      scheduling as unknown as SchedulingService,
    );
  });

  describe('list', () => {
    it('returns zeroed stats for a sequence with no contacts or emails yet', async () => {
      sequences.findAllByOrganization.mockResolvedValue([buildSequence()]);
      users.findAll.mockResolvedValue([{ id: 'exec_1', firstName: 'Ejecutivo', lastName: 'Uno' } as User]);

      const [row] = await service.list(orgId);

      expect(row.prospectCount).toBe(0);
      expect(row.sentStep1).toBe(0);
      expect(row.repliedCount).toBe(0);
      expect(row.stoppedCount).toBe(0);
      expect(row.executiveName).toBe('Ejecutivo Uno');
    });

    it('counts sent emails per step position, replies, bounces, and stopped prospects', async () => {
      sequences.findAllByOrganization.mockResolvedValue([buildSequence()]);
      steps.findBySequence.mockResolvedValue([
        buildStep({ id: 'step_1', position: 1 }),
        buildStep({ id: 'step_2', position: 2 }),
      ]);
      sequenceContacts.findAllByOrganization.mockResolvedValue([
        buildContact({ id: 'c1', status: 'REPLIED', repliedAt: new Date('2026-08-02T09:00:00Z') }),
        buildContact({ id: 'c2', status: 'BOUNCED' }),
        buildContact({ id: 'c3', status: 'REMOVED', stoppedAt: new Date('2026-08-03T09:00:00Z') }),
        buildContact({ id: 'c4', status: 'ACTIVE' }),
      ]);
      scheduledEmails.findAll.mockResolvedValue([
        buildEmail({ id: 'e1', sequenceStepId: 'step_1', status: 'SENT' }),
        buildEmail({ id: 'e2', sequenceStepId: 'step_1', status: 'SENT' }),
        buildEmail({ id: 'e3', sequenceStepId: 'step_2', status: 'SENT' }),
        buildEmail({ id: 'e4', sequenceStepId: 'step_2', status: 'FAILED', sentAt: null }),
      ]);

      const [row] = await service.list(orgId);

      expect(row.prospectCount).toBe(4);
      expect(row.sentStep1).toBe(2);
      expect(row.sentStep2).toBe(1);
      expect(row.sentStep3).toBe(0);
      expect(row.repliedCount).toBe(1);
      expect(row.bouncedCount).toBe(1);
      expect(row.stoppedCount).toBe(1);
      expect(row.errorCount).toBe(1);
    });

    it('filters by executiveId, clientId, and status', async () => {
      sequences.findAllByOrganization.mockResolvedValue([
        buildSequence({ id: 'a', executiveId: 'exec_1', clientId: 'client_1', status: 'DRAFT' }),
        buildSequence({ id: 'b', executiveId: 'exec_2', clientId: 'client_1', status: 'DRAFT' }),
        buildSequence({ id: 'c', executiveId: 'exec_1', clientId: 'client_2', status: 'ARCHIVED' }),
      ]);

      const filtered = await service.list(orgId, { executiveId: 'exec_1', clientId: 'client_1' });
      expect(filtered.map((r) => r.id)).toEqual(['a']);

      const activeOnly = await service.list(orgId, { activeOnly: true });
      expect(activeOnly.map((r) => r.id).sort()).toEqual(['a', 'b']);

      const finishedOnly = await service.list(orgId, { activeOnly: false });
      expect(finishedOnly.map((r) => r.id)).toEqual(['c']);
    });

    it('filters by search across name, client, executive and mailbox', async () => {
      sequences.findAllByOrganization.mockResolvedValue([buildSequence()]);
      users.findAll.mockResolvedValue([{ id: 'exec_1', firstName: 'Sofía', lastName: 'Rojas' } as User]);
      managedClients.findAll.mockResolvedValue([{ id: 'client_1', name: 'GTD' } as ManagedClient]);

      const bySofia = await service.list(orgId, { search: 'sofía' });
      expect(bySofia).toHaveLength(1);

      const byUnrelated = await service.list(orgId, { search: 'no-existe' });
      expect(byUnrelated).toHaveLength(0);
    });
  });

  describe('getDetail', () => {
    it('throws NotFoundException for a sequence in a different organization (never 403)', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ organizationId: 'org_2' }));

      await expect(service.getDetail(orgId, 'sequence_1')).rejects.toThrow(NotFoundException);
    });

    it('prefers the sent snapshot over the live draft once a step has been sent', async () => {
      sequences.findById.mockResolvedValue(buildSequence());
      steps.findBySequence.mockResolvedValue([buildStep({ subject: 'Borrador editado luego' })]);
      scheduledEmails.findAll.mockResolvedValue([
        buildEmail({ subjectSnapshot: 'Asunto real enviado', htmlBodySnapshot: '<p>Cuerpo real enviado</p>' }),
      ]);

      const detail = await service.getDetail(orgId, 'sequence_1');

      expect(detail.steps[0].subject).toBe('Asunto real enviado');
      expect(detail.steps[0].isSentSnapshot).toBe(true);
    });

    it('falls back to the live draft when nothing has been sent yet', async () => {
      sequences.findById.mockResolvedValue(buildSequence());
      steps.findBySequence.mockResolvedValue([buildStep({ subject: 'Borrador sin enviar' })]);
      scheduledEmails.findAll.mockResolvedValue([]);

      const detail = await service.getDetail(orgId, 'sequence_1');

      expect(detail.steps[0].subject).toBe('Borrador sin enviar');
      expect(detail.steps[0].isSentSnapshot).toBe(false);
    });

    it('merges audit log entries and contact milestones into one sorted event history', async () => {
      sequences.findById.mockResolvedValue(buildSequence());
      auditLogs.findAll.mockResolvedValue([
        {
          id: 'log_1',
          organizationId: orgId,
          actorId: 'admin_1',
          action: 'sequence.create_wizard',
          entityType: 'Sequence',
          entityId: 'sequence_1',
          metadata: {},
          createdAt: new Date('2026-08-01T10:00:00Z'),
        },
      ]);
      sequenceContacts.findBySequence.mockResolvedValue([
        buildContact({ repliedAt: new Date('2026-08-02T09:00:00Z') }),
      ]);

      const detail = await service.getDetail(orgId, 'sequence_1');

      expect(detail.events.map((e) => e.type)).toEqual(['contact.replied', 'sequence.create_wizard']);
    });
  });

  describe('cancelPendingSends', () => {
    it('cancels pending jobs and audits the action', async () => {
      sequences.findById.mockResolvedValue(buildSequence());
      scheduling.cancelFutureJobsForSequence.mockResolvedValue(3);

      const cancelled = await service.cancelPendingSends(orgId, 'sequence_1', 'admin_1');

      expect(cancelled).toBe(3);
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sequence.cancel_pending_sends', metadata: { cancelledJobs: 3 } }),
      );
    });

    it('throws NotFoundException for a sequence in a different organization', async () => {
      sequences.findById.mockResolvedValue(buildSequence({ organizationId: 'org_2' }));

      await expect(service.cancelPendingSends(orgId, 'sequence_1', 'admin_1')).rejects.toThrow(NotFoundException);
      expect(scheduling.cancelFutureJobsForSequence).not.toHaveBeenCalled();
    });
  });
});
