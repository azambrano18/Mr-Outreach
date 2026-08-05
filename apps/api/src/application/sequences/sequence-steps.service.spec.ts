import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { EngineClient } from '../../domain/engine/engine-client';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { Organization } from '../../domain/organization/organization.entity';
import { OrganizationRepository } from '../../domain/organization/organization.repository';
import { Sequence } from '../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SequenceStepVersion } from '../../domain/sequence/sequence-step-version.entity';
import { SequenceStepVersionRepository } from '../../domain/sequence/sequence-step-version.repository';
import { SequenceStep } from '../../domain/sequence/sequence-step.entity';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { Signature } from '../../domain/signature/signature.entity';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { HtmlSanitizerService } from '../../infrastructure/security/html-sanitizer.service';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { SequenceStepsService } from './sequence-steps.service';

describe('SequenceStepsService', () => {
  let steps: jest.Mocked<SequenceStepRepository>;
  let stepVersions: jest.Mocked<SequenceStepVersionRepository>;
  let sequences: jest.Mocked<SequenceRepository>;
  let mailboxes: jest.Mocked<MailboxRepository>;
  let signatures: jest.Mocked<SignatureRepository>;
  let signatureVersions: jest.Mocked<SignatureVersionRepository>;
  let users: jest.Mocked<UserRepository>;
  let organizations: jest.Mocked<OrganizationRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let engineClient: jest.Mocked<EngineClient>;
  let sanitizer: jest.Mocked<HtmlSanitizerService>;
  let secrets: jest.Mocked<SecretEncryptionService>;
  let service: SequenceStepsService;

  const orgId = 'org_1';

  const buildSequence = (overrides: Partial<Sequence> = {}): Sequence =>
    ({
      id: 'sequence_1',
      organizationId: orgId,
      executiveId: 'exec_1',
      mailboxId: 'mailbox_1',
      ...overrides,
    }) as Sequence;

  const buildMailbox = (overrides: Partial<Mailbox> = {}): Mailbox =>
    ({
      id: 'mailbox_1',
      organizationId: orgId,
      email: 'ventas@example.com',
      fromName: 'Ventas',
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        encryption: 'STARTTLS',
        username: 'ventas@example.com',
        verifyCertificate: true,
        secretCiphertext: 'iv.tag.cipher',
      },
      ...overrides,
    }) as Mailbox;

  const buildStep = (overrides: Partial<SequenceStep> = {}): SequenceStep =>
    ({
      id: 'step_1',
      organizationId: orgId,
      sequenceId: 'sequence_1',
      position: 1,
      name: 'Step 1',
      subject: 'Asunto {contact.firstName}',
      preheader: null,
      htmlBody: '<p>Hola {contact.firstName}</p>',
      plainTextBody: 'Hola {contact.firstName}',
      delayValue: 0,
      delayUnit: 'DAYS',
      sendMode: 'NEW_THREAD',
      status: 'DRAFT',
      ...overrides,
    }) as SequenceStep;

  const buildSignature = (overrides: Partial<Signature> = {}): Signature =>
    ({
      id: 'signature_1',
      organizationId: orgId,
      mailboxId: 'mailbox_1',
      status: 'ACTIVE',
      activeVersionId: 'version_1',
      ...overrides,
    }) as Signature;

  const buildSignatureVersion = (overrides: Partial<SequenceStepVersion> = {}) =>
    ({
      id: 'version_1',
      signatureId: 'signature_1',
      versionNumber: 1,
      htmlContent: '<p>Firma de Ventas</p>',
      plainTextContent: 'Firma de Ventas',
      createdAt: new Date(),
      createdBy: 'admin_1',
      ...overrides,
    }) as unknown as ReturnType<typeof buildSignature> & {
      htmlContent: string;
      plainTextContent: string;
    };

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'exec_1',
      organizationId: orgId,
      name: 'Ejecutivo Uno',
      email: 'e@example.com',
      ...overrides,
    }) as User;

  const buildOrganization = (): Organization =>
    ({ id: orgId, name: 'MejoReferido' }) as Organization;

  beforeEach(() => {
    steps = {
      findById: jest.fn(),
      findBySequence: jest.fn().mockResolvedValue([]),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    stepVersions = { create: jest.fn(), findByStep: jest.fn() };
    sequences = {
      findById: jest.fn(),
      findByExecutive: jest.fn(),
      findByClient: jest.fn(),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      conditionalUpdatePublishStatus: jest.fn(),
      delete: jest.fn(),
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
    organizations = {
      findById: jest.fn().mockResolvedValue(buildOrganization()),
      create: jest.fn(),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    engineClient = {
      testMailbox: jest.fn(),
      sendMail: jest.fn(),
      checkHealth: jest.fn(),
      fetchInbox: jest.fn(),
      fetchThread: jest.fn(),
      setThreadReadState: jest.fn(),
    };
    sanitizer = {
      sanitize: jest.fn((html: string) => html),
    } as unknown as jest.Mocked<HtmlSanitizerService>;
    secrets = {
      encrypt: jest.fn(),
      decrypt: jest.fn(() => 'decrypted-password'),
    } as unknown as jest.Mocked<SecretEncryptionService>;

    service = new SequenceStepsService(
      steps,
      stepVersions,
      sequences,
      mailboxes,
      signatures,
      signatureVersions,
      users,
      organizations,
      auditLogs,
      engineClient,
      sanitizer,
      secrets,
    );
  });

  describe('create', () => {
    it('sanitizes the HTML, auto-generates plain text, sets position to siblings.length+1, and creates version 1', async () => {
      sequences.findById.mockResolvedValue(buildSequence());
      steps.findBySequence.mockResolvedValue([buildStep()]);
      steps.create.mockResolvedValue(buildStep({ id: 'step_2', position: 2 }));

      await service.create(
        orgId,
        'sequence_1',
        {
          name: 'Step 2',
          subject: 'Asunto',
          htmlBody: '<p>Hola</p>',
          delayValue: 2,
          delayUnit: 'DAYS',
          sendMode: 'REPLY',
        },
        'admin_1',
      );

      expect(sanitizer.sanitize).toHaveBeenCalledWith('<p>Hola</p>');
      expect(steps.create).toHaveBeenCalledWith(expect.objectContaining({ position: 2 }));
      expect(stepVersions.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('creates a new version when content fields change', async () => {
      steps.findById.mockResolvedValue(buildStep());
      sequences.findById.mockResolvedValue(buildSequence());
      steps.update.mockResolvedValue(buildStep({ subject: 'Nuevo asunto' }));

      await service.update(orgId, 'step_1', { subject: 'Nuevo asunto' }, 'admin_1');

      expect(stepVersions.create).toHaveBeenCalledTimes(1);
    });

    it('does not create a new version for a status-only change', async () => {
      steps.findById.mockResolvedValue(buildStep());
      sequences.findById.mockResolvedValue(buildSequence());
      steps.update.mockResolvedValue(buildStep({ status: 'PUBLISHED' }));

      await service.update(orgId, 'step_1', { status: 'PUBLISHED' }, 'admin_1');

      expect(stepVersions.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a step in a different organization (never 403)', async () => {
      steps.findById.mockResolvedValue(buildStep({ organizationId: 'org_2' }));

      await expect(service.update(orgId, 'step_1', { subject: 'X' }, 'admin_1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes and renormalizes remaining sibling positions', async () => {
      steps.findById.mockResolvedValue(buildStep({ id: 'step_2', position: 2 }));
      sequences.findById.mockResolvedValue(buildSequence());
      steps.findBySequence.mockResolvedValue([
        buildStep({ id: 'step_1', position: 1 }),
        buildStep({ id: 'step_3', position: 3 }),
      ]);

      await service.remove(orgId, 'step_2', 'admin_1');

      expect(steps.remove).toHaveBeenCalledWith('step_2');
      // step_3 moves from position 3 -> 2; step_1 already correct, untouched.
      expect(steps.update).toHaveBeenCalledWith('step_3', expect.objectContaining({ position: 2 }));
      expect(steps.update).not.toHaveBeenCalledWith('step_1', expect.anything());
    });
  });

  describe('requireOwnedByExecutive', () => {
    it('returns the summary when the step’s parent sequence belongs to that executive', async () => {
      steps.findById.mockResolvedValue(buildStep());
      sequences.findById.mockResolvedValue(buildSequence({ executiveId: 'exec_1' }));

      const result = await service.requireOwnedByExecutive(orgId, 'step_1', 'exec_1');

      expect(result.id).toBe('step_1');
    });

    it('throws NotFoundException (not ForbiddenException) when the parent sequence belongs to a different executive', async () => {
      steps.findById.mockResolvedValue(buildStep());
      sequences.findById.mockResolvedValue(buildSequence({ executiveId: 'exec_1' }));

      await expect(service.requireOwnedByExecutive(orgId, 'step_1', 'exec_2')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('duplicate', () => {
    it('shifts subsequent steps down and inserts the copy right after the original', async () => {
      steps.findById.mockResolvedValue(buildStep({ position: 1 }));
      sequences.findById.mockResolvedValue(buildSequence());
      steps.findBySequence.mockResolvedValue([
        buildStep({ id: 'step_1', position: 1 }),
        buildStep({ id: 'step_2', position: 2 }),
      ]);
      steps.create.mockResolvedValue(buildStep({ id: 'step_copy', position: 2 }));

      await service.duplicate(orgId, 'step_1', 'admin_1');

      expect(steps.update).toHaveBeenCalledWith('step_2', expect.objectContaining({ position: 3 }));
      expect(steps.create).toHaveBeenCalledWith(expect.objectContaining({ position: 2 }));
      expect(stepVersions.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('reorder', () => {
    it('rejects a list that does not contain exactly the current steps', async () => {
      sequences.findById.mockResolvedValue(buildSequence());
      steps.findBySequence.mockResolvedValue([
        buildStep({ id: 'step_1' }),
        buildStep({ id: 'step_2' }),
      ]);

      await expect(
        service.reorder(orgId, 'sequence_1', ['step_1', 'step_3'], 'admin_1'),
      ).rejects.toThrow(BadRequestException);
      expect(steps.update).not.toHaveBeenCalled();
    });

    it('reassigns positions 1..N in the given order', async () => {
      sequences.findById.mockResolvedValue(buildSequence());
      steps.findBySequence
        .mockResolvedValueOnce([
          buildStep({ id: 'step_1', position: 1 }),
          buildStep({ id: 'step_2', position: 2 }),
        ])
        .mockResolvedValueOnce([
          buildStep({ id: 'step_2', position: 1 }),
          buildStep({ id: 'step_1', position: 2 }),
        ]);

      await service.reorder(orgId, 'sequence_1', ['step_2', 'step_1'], 'admin_1');

      expect(steps.update).toHaveBeenCalledWith('step_2', expect.objectContaining({ position: 1 }));
      expect(steps.update).toHaveBeenCalledWith('step_1', expect.objectContaining({ position: 2 }));
    });
  });

  describe('preview', () => {
    it('composes the step body with the mailbox signature and resolves contact/sender variables', async () => {
      steps.findById.mockResolvedValue(buildStep());
      sequences.findById.mockResolvedValue(buildSequence());
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature());
      signatureVersions.findById.mockResolvedValue(buildSignatureVersion() as never);
      users.findById.mockResolvedValue(buildUser());

      const result = await service.preview(orgId, 'step_1');

      expect(result.signatureApplied).toBe(true);
      expect(result.renderedHtml).toContain('Firma de Ventas');
      expect(result.renderedHtml).toContain('Juan');
      expect(result.renderedHtml).not.toContain('{contact.firstName}');
      expect(result.senderMailboxEmail).toBe('ventas@example.com');
    });

    it('marks signatureApplied false when the mailbox has no active signature', async () => {
      steps.findById.mockResolvedValue(buildStep());
      sequences.findById.mockResolvedValue(buildSequence());
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(null);
      users.findById.mockResolvedValue(buildUser());

      const result = await service.preview(orgId, 'step_1');

      expect(result.signatureApplied).toBe(false);
    });

    it('throws BadRequestException when the sequence has no sender account yet', async () => {
      steps.findById.mockResolvedValue(buildStep());
      sequences.findById.mockResolvedValue(buildSequence({ mailboxId: null }));

      await expect(service.preview(orgId, 'step_1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendTest', () => {
    it('decrypts the SMTP secret, sends through the engine client, and never leaks the recipient in the audit metadata', async () => {
      steps.findById.mockResolvedValue(buildStep());
      sequences.findById.mockResolvedValue(buildSequence());
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(null);
      users.findById.mockResolvedValue(buildUser());
      engineClient.sendMail.mockResolvedValue({ accepted: true, messageId: 'msg_1' });

      const result = await service.sendTest(orgId, 'step_1', 'destino@example.com', 'admin_1');

      expect(secrets.decrypt).toHaveBeenCalledWith('iv.tag.cipher');
      const callArg = engineClient.sendMail.mock.calls[0][0];
      expect(callArg.smtp.password).toBe('decrypted-password');
      expect(callArg.to).toBe('destino@example.com');
      expect(result.accepted).toBe(true);

      const auditCall = auditLogs.record.mock.calls.find(
        (call) => call[0].action === 'sequence_step.test_send',
      );
      expect(auditCall).toBeDefined();
      expect(JSON.stringify(auditCall![0])).not.toContain('destino@example.com');
    });
  });
});
