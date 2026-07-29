import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceContact } from '../../domain/sequence-contact/sequence-contact.entity';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { SequenceStepVersionRepository } from '../../domain/sequence/sequence-step-version.repository';
import { SequenceStep } from '../../domain/sequence/sequence-step.entity';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SchedulingService } from './scheduling.service';

describe('SchedulingService.createBatch', () => {
  let scheduledEmails: jest.Mocked<ScheduledEmailRepository>;
  let sequenceContacts: jest.Mocked<SequenceContactRepository>;
  let sequences: jest.Mocked<SequenceRepository>;
  let steps: jest.Mocked<SequenceStepRepository>;
  let stepVersions: jest.Mocked<SequenceStepVersionRepository>;
  let mailboxes: jest.Mocked<MailboxRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let service: SchedulingService;

  const orgId = 'org_1';
  const sequenceId = 'sequence_1';

  const buildStep = (overrides: Partial<SequenceStep> = {}): SequenceStep => ({
    id: 'step_2',
    organizationId: orgId,
    sequenceId,
    position: 2,
    name: 'Seguimiento 2',
    subject: 'Subject',
    preheader: null,
    htmlHeader: null,
    htmlBody: '<p>hi</p>',
    plainTextBody: 'hi',
    delayValue: 2,
    delayUnit: 'DAYS',
    sendMode: 'REPLY',
    status: 'PUBLISHED',
    createdBy: 'admin_1',
    updatedBy: 'admin_1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  });

  const buildContact = (overrides: Partial<SequenceContact> = {}): SequenceContact => ({
    id: 'seqcontact_1',
    organizationId: orgId,
    clientId: 'client_1',
    sequenceId,
    sequenceVersion: 1,
    contactId: 'contact_1',
    companyId: null,
    sourceImportId: null,
    assignedMailboxId: 'mailbox_1',
    assignedExecutiveId: 'exec_1',
    currentStepId: 'step_2',
    currentStepPosition: 2,
    status: 'ACTIVE',
    nextScheduledAt: null,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    lastSentAt: new Date('2026-01-05T10:00:00Z'), // Step 1's ACTUAL send time — must be the basis, not "today".
    repliedAt: null,
    completedAt: null,
    stoppedAt: null,
    stopReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const buildMailbox = (): Mailbox =>
    ({
      id: 'mailbox_1',
      organizationId: orgId,
      clientId: 'client_1',
      domainId: 'domain_1',
      name: 'Ventas',
      email: 'ventas@example.com',
      fromName: 'Ventas',
      replyTo: null,
      status: 'ACTIVE',
      connectionStatus: 'CONNECTED',
      provisioningStatus: 'PROVISIONED',
      timezone: 'America/Santiago',
      sendingLimits: { dailyLimit: 40, minimumIntervalSeconds: 60, maximumIntervalSeconds: 180 },
      lastProvisionCommandId: 'cmd_1',
      lastTestedAt: null,
      lastTestedBy: null,
      lastTestMessage: null,
      imap: {
        host: 'imap.example.com',
        port: 993,
        encryption: 'SSL_TLS',
        username: 'ventas@example.com',
        verifyCertificate: true,
        secretCiphertext: 'x',
      },
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        encryption: 'STARTTLS',
        username: 'ventas@example.com',
        verifyCertificate: true,
        secretCiphertext: 'x',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }) as Mailbox;

  beforeEach(() => {
    scheduledEmails = {
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findBySequenceContact: jest.fn().mockResolvedValue([]),
      findManyBySequenceContactIds: jest.fn().mockResolvedValue([]),
      findAll: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      cancelFutureForSequenceContact: jest.fn(),
      cancelFutureForSequenceCompany: jest.fn(),
      cancelFutureForMailbox: jest.fn(),
    };
    sequenceContacts = {
      findById: jest.fn(),
      findBySequence: jest.fn(),
      findByContactAndSequence: jest.fn(),
      findByContact: jest.fn(),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn(),
      bulkSetScheduled: jest.fn(),
      conditionalRemove: jest.fn(),
      bulkRemoveByCompany: jest.fn(),
    };
    steps = {
      findById: jest.fn(),
      findBySequence: jest.fn(),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    stepVersions = { create: jest.fn(), findByStep: jest.fn().mockResolvedValue([{ versionNumber: 3 }]) };
    mailboxes = { findById: jest.fn(), findByEmail: jest.fn(), findByServerMailboxId: jest.fn(), findAll: jest.fn(), create: jest.fn(), createLinked: jest.fn(), update: jest.fn() };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    sequences = {
      findById: jest.fn().mockResolvedValue({ timezone: 'America/Santiago' }),
      findByExecutive: jest.fn(),
      findByClient: jest.fn(),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      conditionalUpdatePublishStatus: jest.fn(),
    };

    service = new SchedulingService(scheduledEmails, sequenceContacts, sequences, steps, stepVersions, mailboxes, auditLogs);
  });

  it('computes scheduledAt from the CONTACT\'S OWN previous send, never from "now" (§22)', async () => {
    // lastSentAt is set 1 hour in the future so the delay-derived time
    // (lastSentAt + 2 days) is unambiguously later than "now" — isolating
    // the assertion from the clamp-to-now floor createBatch also applies
    // (a real batch run must never schedule an email in the past).
    const lastSentAt = new Date(Date.now() + 60 * 60 * 1000);
    const contact = buildContact({ lastSentAt });
    sequenceContacts.findBySequence.mockResolvedValue([contact]);
    steps.findById.mockResolvedValue(buildStep({ delayValue: 2, delayUnit: 'DAYS' }));
    mailboxes.findById.mockResolvedValue(buildMailbox());
    scheduledEmails.create.mockImplementation(
      async (input) => ({ ...input, id: 'se_1', status: 'PENDING', attemptCount: 0 }) as any,
    );

    const result = await service.createBatch(orgId, sequenceId, 'admin_1');

    expect(result.total).toBe(1);
    const created = scheduledEmails.create.mock.calls[0][0];
    const expected = new Date(lastSentAt.getTime() + 2 * 24 * 60 * 60 * 1000);
    expect(created.scheduledAt.toISOString()).toBe(expected.toISOString());
    expect(created.priority).toBe('FOLLOW_UP');
  });

  it('prioritizes follow-ups (step position > 1) ahead of brand-new contacts within the same batch', async () => {
    const followUp = buildContact({ id: 'seqcontact_followup', currentStepPosition: 2, lastSentAt: new Date() });
    const brandNew = buildContact({
      id: 'seqcontact_new',
      currentStepId: 'step_1',
      currentStepPosition: 1,
      lastSentAt: null,
    });
    sequenceContacts.findBySequence.mockResolvedValue([brandNew, followUp]);
    steps.findById.mockImplementation(async (id) =>
      id === 'step_1' ? buildStep({ id: 'step_1', position: 1, delayValue: 0 }) : buildStep(),
    );
    mailboxes.findById.mockResolvedValue(buildMailbox());
    scheduledEmails.create.mockImplementation(
      async (input) => ({ ...input, id: `se_${input.sequenceContactId}`, status: 'PENDING', attemptCount: 0 }) as any,
    );

    const result = await service.createBatch(orgId, sequenceId, 'admin_1');

    expect(result.total).toBe(2);
    expect(result.followUps).toBe(1);
    expect(result.newContacts).toBe(1);
    // The follow-up must be the FIRST one scheduled/created despite appearing second in the input.
    expect(scheduledEmails.create.mock.calls[0][0].sequenceContactId).toBe('seqcontact_followup');
  });
});
