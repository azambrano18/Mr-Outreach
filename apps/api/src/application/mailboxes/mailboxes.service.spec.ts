import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { EngineClient, TestMailboxResult } from '../../domain/engine/engine-client';
import { MailboxAssignment } from '../../domain/mailbox-assignment/mailbox-assignment.entity';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxConnectionTestRepository } from '../../domain/mailbox/mailbox-connection-test.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { ClientsService } from '../clients/clients.service';
import { MailboxesService } from './mailboxes.service';

describe('MailboxesService', () => {
  let mailboxes: jest.Mocked<MailboxRepository>;
  let connectionTests: jest.Mocked<MailboxConnectionTestRepository>;
  let assignments: jest.Mocked<MailboxAssignmentRepository>;
  let users: jest.Mocked<UserRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let engineClient: jest.Mocked<EngineClient>;
  let domains: jest.Mocked<DomainRepository>;
  let secrets: jest.Mocked<SecretEncryptionService>;
  let clients: jest.Mocked<ClientsService>;
  let service: MailboxesService;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';

  const protocolConfig = (overrides: Partial<Mailbox['imap']> = {}) => ({
    host: 'imap.example.com',
    port: 993,
    encryption: 'SSL_TLS' as const,
    username: 'ventas@example.com',
    verifyCertificate: true,
    secretCiphertext: 'iv.tag.cipher',
    ...overrides,
  });

  const buildMailbox = (overrides: Partial<Mailbox> = {}): Mailbox => ({
    id: 'mailbox_1',
    organizationId: orgId,
    clientId: null,
    domainId: null,
    name: 'Ventas',
    email: 'ventas@example.com',
    fromName: 'Equipo de Ventas',
    replyTo: null,
    status: 'ACTIVE',
    connectionStatus: 'NOT_TESTED',
    provisioningStatus: 'NOT_PROVISIONED',
    timezone: 'America/Santiago',
    sendingLimits: { dailyLimit: 40, minimumIntervalSeconds: 60, maximumIntervalSeconds: 180 },
    lastProvisionCommandId: null,
    lastTestedAt: null,
    lastTestedBy: null,
    lastTestMessage: null,
    imap: protocolConfig(),
    smtp: protocolConfig({ port: 587, encryption: 'STARTTLS' }),
    linkSource: 'LEGACY_LOCAL',
    linkStatus: 'LEGACY',
    serverMailboxId: null,
    serverDomainId: null,
    serverClientId: null,
    serverRedemptionId: null,
    tokenFingerprint: null,
    emailSnapshot: null,
    domainSnapshot: null,
    clientNameSnapshot: null,
    serverStatusSnapshot: null,
    serverCanSendSnapshot: null,
    serverStatusCheckedAt: null,
    linkedAt: null,
    linkedBy: null,
    unlinkRequestedAt: null,
    unlinkRequestedBy: null,
    unlinkReason: null,
    unlinkRemoveAssignments: false,
    revokedAt: null,
    revocationId: null,
    lastLinkCommandId: null,
    assetCleanupStatus: 'NOT_NEEDED',
    assetCleanupAttempts: 0,
    lastAssetCleanupError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  });

  const buildUser = (overrides: Partial<User> = {}): User => ({
    id: 'user_1',
    organizationId: orgId,
    firstName: 'Ejecutivo',
    lastName: 'Uno',
    email: 'ejecutivo1@example.com',
    passwordHash: 'hash',
    status: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: null,
    passwordChangedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  });

  const buildAssignment = (overrides: Partial<MailboxAssignment> = {}): MailboxAssignment => ({
    id: 'assignment_1',
    organizationId: orgId,
    mailboxId: 'mailbox_1',
    userId: 'user_1',
    role: 'SECONDARY',
    assignedBy: 'admin_1',
    assignedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
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
    connectionTests = { record: jest.fn(), findByMailbox: jest.fn() };
    assignments = {
      upsert: jest.fn(),
      remove: jest.fn(),
      findByMailbox: jest.fn().mockResolvedValue([]),
      findByUser: jest.fn().mockResolvedValue([]),
      findAllByOrganization: jest.fn().mockResolvedValue([]),
    };
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
    engineClient = {
      testMailbox: jest.fn(),
      sendMail: jest.fn(),
      checkHealth: jest.fn(),
      fetchInbox: jest.fn(),
      fetchThread: jest.fn(),
      setThreadReadState: jest.fn(),
    };
    domains = {
      findById: jest.fn(),
      findByClient: jest.fn(),
      findByName: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    // Hex-encodes rather than embedding the plaintext verbatim, so the
    // "never leaks the plaintext" assertions below are actually
    // meaningful instead of trivially failing on the mock's own echo.
    secrets = {
      encrypt: jest.fn((plaintext: string) => Buffer.from(plaintext, 'utf8').toString('hex')),
      decrypt: jest.fn(() => 'decrypted-password'),
    } as unknown as jest.Mocked<SecretEncryptionService>;

    clients = {
      assertClientCrmEligible: jest.fn(),
      getOwnedClient: jest.fn(),
    } as unknown as jest.Mocked<ClientsService>;

    service = new MailboxesService(
      mailboxes,
      connectionTests,
      assignments,
      users,
      auditLogs,
      engineClient,
      domains,
      { getMailboxStatus: jest.fn(), introspectLinkToken: jest.fn(), redeemLinkToken: jest.fn(), unlinkMailbox: jest.fn() } as never,
      secrets,
      clients,
    );
  });

  describe('create', () => {
    const payload = {
      name: 'Ventas',
      email: 'ventas@example.com',
      fromName: 'Equipo de Ventas',
      imap: {
        host: 'imap.example.com',
        port: 993,
        encryption: 'SSL_TLS' as const,
        username: 'ventas@example.com',
        password: 'plaintext-imap-password',
        verifyCertificate: true,
      },
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        encryption: 'STARTTLS' as const,
        username: 'ventas@example.com',
        password: 'plaintext-smtp-password',
        verifyCertificate: true,
      },
    };

    it('encrypts both secrets before persisting and never passes the plaintext to the repository', async () => {
      mailboxes.create.mockResolvedValue(buildMailbox());

      await service.create(orgId, payload, 'actor_1');

      expect(secrets.encrypt).toHaveBeenCalledWith('plaintext-imap-password');
      expect(secrets.encrypt).toHaveBeenCalledWith('plaintext-smtp-password');
      const createArg = mailboxes.create.mock.calls[0][0];
      expect(createArg.imap.secretCiphertext).toBe(
        Buffer.from('plaintext-imap-password', 'utf8').toString('hex'),
      );
      expect(createArg.smtp.secretCiphertext).toBe(
        Buffer.from('plaintext-smtp-password', 'utf8').toString('hex'),
      );
      expect(JSON.stringify(createArg)).not.toContain('plaintext-imap-password');
      expect(JSON.stringify(createArg)).not.toContain('plaintext-smtp-password');
    });

    it('records an audit entry and returns a summary that never includes any secret', async () => {
      mailboxes.create.mockResolvedValue(buildMailbox());

      const result = await service.create(orgId, payload, 'actor_1');

      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'mailbox.create' }),
      );
      expect(JSON.stringify(result)).not.toMatch(/password|secretCiphertext|iv\.tag\.cipher/i);
      expect(result.imap!.credentialsConfigured).toBe(true);
      expect(result.smtp!.credentialsConfigured).toBe(true);
    });
  });

  describe('update', () => {
    it('updates only the provided fields, leaving the stored secret untouched when no password is sent', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      mailboxes.update.mockResolvedValue(buildMailbox({ name: 'Ventas Norte' }));

      await service.update(orgId, 'mailbox_1', { name: 'Ventas Norte' }, 'actor_1');

      expect(mailboxes.update).toHaveBeenCalledWith('mailbox_1', { name: 'Ventas Norte' });
      expect(secrets.encrypt).not.toHaveBeenCalled();
    });

    it('re-encrypts the secret only when a new password is explicitly provided', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      mailboxes.update.mockResolvedValue(buildMailbox());

      await service.update(
        orgId,
        'mailbox_1',
        { imap: { password: 'new-imap-password' } },
        'actor_1',
      );

      expect(secrets.encrypt).toHaveBeenCalledWith('new-imap-password');
      expect(mailboxes.update).toHaveBeenCalledWith('mailbox_1', {
        imap: { secretCiphertext: Buffer.from('new-imap-password', 'utf8').toString('hex') },
      });
    });

    it('throws NotFoundException for a mailbox in a different organization (never 403)', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox({ organizationId: otherOrgId }));

      await expect(service.update(orgId, 'mailbox_1', { name: 'X' }, 'actor_1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setStatus', () => {
    it('deactivates a mailbox and audits the action', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      mailboxes.update.mockResolvedValue(buildMailbox({ status: 'INACTIVE' }));

      const result = await service.setStatus(orgId, 'mailbox_1', 'INACTIVE', 'actor_1');

      expect(mailboxes.update).toHaveBeenCalledWith('mailbox_1', { status: 'INACTIVE' });
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'mailbox.deactivate' }),
      );
      expect(result.status).toBe('INACTIVE');
    });
  });

  describe('getById / list', () => {
    it('resolves clientName/domainName from the snapshot for a SERVER_TOKEN mailbox, without touching the client/domain repositories', async () => {
      mailboxes.findById.mockResolvedValue(
        buildMailbox({
          clientId: 'client_1',
          domainId: 'domain_1',
          linkSource: 'SERVER_TOKEN',
          clientNameSnapshot: 'Empresa Demostración',
          domainSnapshot: 'empresademostracion.cl',
        }),
      );

      const result = await service.getById(orgId, 'mailbox_1');

      expect(result.clientName).toBe('Empresa Demostración');
      expect(result.domainName).toBe('empresademostracion.cl');
      expect(clients.getOwnedClient).not.toHaveBeenCalled();
      expect(domains.findById).not.toHaveBeenCalled();
    });

    it('resolves clientName/domainName live for a LEGACY_LOCAL mailbox with no snapshot', async () => {
      mailboxes.findById.mockResolvedValue(
        buildMailbox({ clientId: 'client_1', domainId: 'domain_1', linkSource: 'LEGACY_LOCAL' }),
      );
      clients.getOwnedClient.mockResolvedValue({ id: 'client_1', name: 'Cliente Legado' } as never);
      domains.findById.mockResolvedValue({ id: 'domain_1', domainName: 'legado.cl' } as never);

      const result = await service.getById(orgId, 'mailbox_1');

      expect(result.clientName).toBe('Cliente Legado');
      expect(result.domainName).toBe('legado.cl');
      expect(clients.getOwnedClient).toHaveBeenCalledWith(orgId, 'client_1');
      expect(domains.findById).toHaveBeenCalledWith('domain_1');
    });

    it('leaves clientName/domainName null for an unclassified mailbox (no clientId/domainId)', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox({ clientId: null, domainId: null }));

      const result = await service.getById(orgId, 'mailbox_1');

      expect(result.clientName).toBeNull();
      expect(result.domainName).toBeNull();
      expect(clients.getOwnedClient).not.toHaveBeenCalled();
      expect(domains.findById).not.toHaveBeenCalled();
    });

    it('never returns a mailbox from a different organization', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox({ organizationId: otherOrgId }));

      await expect(service.getById(orgId, 'mailbox_1')).rejects.toThrow(NotFoundException);
    });

    it('list summaries never leak the ciphertext under any field name', async () => {
      mailboxes.findAll.mockResolvedValue([buildMailbox()]);

      const [summary] = await service.list(orgId);

      expect(JSON.stringify(summary)).not.toContain('iv.tag.cipher');
    });
  });

  describe('testConnection', () => {
    const connectedResult: TestMailboxResult = {
      status: 'CONNECTED',
      imap: { success: true },
      smtp: { success: true },
      testedAt: '2026-07-13T00:00:00.000Z',
    };

    it('decrypts both secrets and hands the engine client plaintext passwords, never the ciphertext', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      engineClient.testMailbox.mockResolvedValue(connectedResult);
      mailboxes.update.mockResolvedValue(buildMailbox({ connectionStatus: 'CONNECTED' }));

      await service.testConnection(orgId, 'mailbox_1', 'actor_1');

      expect(secrets.decrypt).toHaveBeenCalledWith('iv.tag.cipher');
      const callArg = engineClient.testMailbox.mock.calls[0][0];
      expect(callArg.imap.password).toBe('decrypted-password');
      expect(callArg.smtp.password).toBe('decrypted-password');
      expect(JSON.stringify(callArg)).not.toContain('iv.tag.cipher');
    });

    it('updates the mailbox status/lastTestedAt/lastTestedBy and records a history entry', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      engineClient.testMailbox.mockResolvedValue(connectedResult);
      mailboxes.update.mockResolvedValue(buildMailbox({ connectionStatus: 'CONNECTED' }));

      await service.testConnection(orgId, 'mailbox_1', 'actor_1');

      expect(mailboxes.update).toHaveBeenCalledWith(
        'mailbox_1',
        expect.objectContaining({
          connectionStatus: 'CONNECTED',
          lastTestedBy: 'actor_1',
          lastTestMessage: expect.stringContaining('exitosa'),
        }),
      );
      expect(connectionTests.record).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          mailboxId: 'mailbox_1',
          status: 'CONNECTED',
          executedBy: 'actor_1',
        }),
      );
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'mailbox.test' }),
      );
    });

    it('reports a partial connection with a message naming which protocol failed', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      engineClient.testMailbox.mockResolvedValue({
        status: 'PARTIALLY_CONNECTED',
        imap: { success: true },
        smtp: { success: false, errorCode: 'SMTP_AUTH_FAILED' },
        testedAt: '2026-07-13T00:00:00.000Z',
      });
      mailboxes.update.mockResolvedValue(buildMailbox({ connectionStatus: 'PARTIALLY_CONNECTED' }));

      const result = await service.testConnection(orgId, 'mailbox_1', 'actor_1');

      expect(result.status).toBe('PARTIALLY_CONNECTED');
      expect(result.message).toContain('SMTP_AUTH_FAILED');
      expect(result.imap.success).toBe(true);
      expect(result.smtp.success).toBe(false);
    });

    it('never returns the connection-test result with any secret embedded', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      engineClient.testMailbox.mockResolvedValue(connectedResult);
      mailboxes.update.mockResolvedValue(buildMailbox());

      const result = await service.testConnection(orgId, 'mailbox_1', 'actor_1');

      expect(JSON.stringify(result)).not.toMatch(/iv\.tag\.cipher|decrypted-password/);
    });

    it('throws NotFoundException for a mailbox in a different organization', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox({ organizationId: otherOrgId }));

      await expect(service.testConnection(orgId, 'mailbox_1', 'actor_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(engineClient.testMailbox).not.toHaveBeenCalled();
    });
  });

  describe('getInbox', () => {
    it('decrypts the IMAP secret and hands the engine client the plaintext password', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      engineClient.fetchInbox.mockResolvedValue({ status: 'OK', threads: [] });

      await service.getInbox(orgId, 'mailbox_1');

      const callArg = engineClient.fetchInbox.mock.calls[0][0];
      expect(callArg.imap.password).toBe('decrypted-password');
      expect(JSON.stringify(callArg)).not.toContain('iv.tag.cipher');
    });

    it('returns the threads the engine client resolves', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      const threads = [
        {
          id: 'thread_1',
          subject: 'Hola',
          participants: [{ name: 'Juan', email: 'juan@example.com' }],
          lastMessageAt: '2026-07-13T00:00:00.000Z',
          lastMessageSnippet: 'snippet',
          unreadCount: 1,
          messageCount: 2,
        },
      ];
      engineClient.fetchInbox.mockResolvedValue({ status: 'OK', threads });

      const result = await service.getInbox(orgId, 'mailbox_1');

      expect(result).toEqual({ status: 'OK', threads });
    });

    it('throws NotFoundException for a mailbox in a different organization', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox({ organizationId: otherOrgId }));

      await expect(service.getInbox(orgId, 'mailbox_1')).rejects.toThrow(NotFoundException);
      expect(engineClient.fetchInbox).not.toHaveBeenCalled();
    });
  });

  describe('getThread', () => {
    it('decrypts the IMAP secret and forwards the thread id to the engine client', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      engineClient.fetchThread.mockResolvedValue({ status: 'OK', messages: [] });

      await service.getThread(orgId, 'mailbox_1', 'thread_1');

      const callArg = engineClient.fetchThread.mock.calls[0][0];
      expect(callArg.threadId).toBe('thread_1');
      expect(callArg.imap.password).toBe('decrypted-password');
    });

    it('throws NotFoundException for a mailbox in a different organization', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox({ organizationId: otherOrgId }));

      await expect(service.getThread(orgId, 'mailbox_1', 'thread_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(engineClient.fetchThread).not.toHaveBeenCalled();
    });
  });

  describe('setThreadReadState / setThreadReadStateForExecutive', () => {
    it('decrypts the IMAP secret and forwards isUnread to the engine client', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      engineClient.setThreadReadState.mockResolvedValue({ status: 'OK' });

      await service.setThreadReadState(orgId, 'mailbox_1', 'thread_1', false, 'actor_1');

      const callArg = engineClient.setThreadReadState.mock.calls[0][0];
      expect(callArg.threadId).toBe('thread_1');
      expect(callArg.isUnread).toBe(false);
      expect(callArg.imap.password).toBe('decrypted-password');
    });

    it('records an audit entry after a successful read-state change', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      engineClient.setThreadReadState.mockResolvedValue({ status: 'OK' });

      await service.setThreadReadState(orgId, 'mailbox_1', 'thread_1', true, 'actor_1');

      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          actorId: 'actor_1',
          action: 'mailbox.thread.read-state',
          entityType: 'Mailbox',
          entityId: 'mailbox_1',
          metadata: { threadId: 'thread_1', isUnread: true },
        }),
      );
    });

    it('throws NotFoundException when the engine reports the thread as NOT_FOUND', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      engineClient.setThreadReadState.mockResolvedValue({ status: 'NOT_FOUND' } as never);

      await expect(
        service.setThreadReadState(orgId, 'mailbox_1', 'thread_1', false, 'actor_1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('setThreadReadStateForExecutive throws NotFoundException for a mailbox not assigned to the executive', async () => {
      assignments.findByUser.mockResolvedValue([]);

      await expect(
        service.setThreadReadStateForExecutive(orgId, 'user_1', 'mailbox_1', 'thread_1', false),
      ).rejects.toThrow(NotFoundException);
      expect(engineClient.setThreadReadState).not.toHaveBeenCalled();
    });
  });

  describe('getAssigneesForExecutive', () => {
    it('throws NotFoundException for a mailbox not assigned to the executive', async () => {
      assignments.findByUser.mockResolvedValue([]);

      await expect(service.getAssigneesForExecutive(orgId, 'user_1', 'mailbox_1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns assignees for a mailbox assigned to the executive', async () => {
      assignments.findByUser.mockResolvedValue([
        buildAssignment({ userId: 'user_1', mailboxId: 'mailbox_1' }),
      ]);
      mailboxes.findById.mockResolvedValue(buildMailbox());
      assignments.findByMailbox.mockResolvedValue([]);

      const result = await service.getAssigneesForExecutive(orgId, 'user_1', 'mailbox_1');

      expect(result).toEqual([]);
    });
  });

  describe('getInboxForExecutive / getThreadForExecutive', () => {
    it('reads the inbox when the mailbox is assigned to the executive', async () => {
      assignments.findByUser.mockResolvedValue([
        buildAssignment({ userId: 'user_1', mailboxId: 'mailbox_1' }),
      ]);
      mailboxes.findById.mockResolvedValue(buildMailbox());
      engineClient.fetchInbox.mockResolvedValue({ status: 'OK', threads: [] });

      const result = await service.getInboxForExecutive(orgId, 'user_1', 'mailbox_1');

      expect(result.status).toBe('OK');
    });

    it('throws NotFoundException (not ForbiddenException) when the mailbox is not assigned to the executive', async () => {
      assignments.findByUser.mockResolvedValue([
        buildAssignment({ userId: 'user_1', mailboxId: 'mailbox_other' }),
      ]);

      await expect(service.getInboxForExecutive(orgId, 'user_1', 'mailbox_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(engineClient.fetchInbox).not.toHaveBeenCalled();
    });

    it('reads a thread when the mailbox is assigned to the executive', async () => {
      assignments.findByUser.mockResolvedValue([
        buildAssignment({ userId: 'user_1', mailboxId: 'mailbox_1' }),
      ]);
      mailboxes.findById.mockResolvedValue(buildMailbox());
      engineClient.fetchThread.mockResolvedValue({ status: 'OK', messages: [] });

      const result = await service.getThreadForExecutive(orgId, 'user_1', 'mailbox_1', 'thread_1');

      expect(result.status).toBe('OK');
    });

    it('throws NotFoundException for a thread on a mailbox not assigned to the executive', async () => {
      assignments.findByUser.mockResolvedValue([]);

      await expect(
        service.getThreadForExecutive(orgId, 'user_1', 'mailbox_1', 'thread_1'),
      ).rejects.toThrow(NotFoundException);
      expect(engineClient.fetchThread).not.toHaveBeenCalled();
    });
  });

  describe('getConnectionTests', () => {
    it('returns the history scoped to the mailbox, most recent first, as provided by the repository', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      connectionTests.findByMailbox.mockResolvedValue([
        {
          id: 'test_2',
          organizationId: orgId,
          mailboxId: 'mailbox_1',
          status: 'CONNECTED',
          imapSuccess: true,
          imapErrorCode: null,
          smtpSuccess: true,
          smtpErrorCode: null,
          message: 'Conexión exitosa a IMAP y SMTP.',
          technicalMessage: 'imap=ok smtp=ok',
          executedBy: 'actor_1',
          createdAt: new Date('2026-07-13T01:00:00Z'),
        },
      ]);

      const history = await service.getConnectionTests(orgId, 'mailbox_1');

      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('CONNECTED');
      expect(connectionTests.findByMailbox).toHaveBeenCalledWith('mailbox_1');
    });

    it('throws NotFoundException for a mailbox in a different organization before touching history', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox({ organizationId: otherOrgId }));

      await expect(service.getConnectionTests(orgId, 'mailbox_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(connectionTests.findByMailbox).not.toHaveBeenCalled();
    });
  });

  describe('getAssignees', () => {
    it('resolves the assignments to summaries including role', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      assignments.findByMailbox.mockResolvedValue([buildAssignment({ role: 'PRIMARY' })]);
      users.findById.mockResolvedValue(buildUser());

      const result = await service.getAssignees(orgId, 'mailbox_1');

      expect(result).toEqual([
        {
          id: 'user_1',
          name: 'Ejecutivo Uno',
          email: 'ejecutivo1@example.com',
          status: 'ACTIVE',
          role: 'PRIMARY',
        },
      ]);
    });

    it('silently drops an assignment whose user no longer resolves in this org', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      assignments.findByMailbox.mockResolvedValue([
        buildAssignment({ userId: 'user_1' }),
        buildAssignment({ userId: 'user_stale' }),
      ]);
      users.findById.mockImplementation((id) =>
        Promise.resolve(id === 'user_1' ? buildUser() : null),
      );

      const result = await service.getAssignees(orgId, 'mailbox_1');

      expect(result).toHaveLength(1);
    });

    it('throws NotFoundException for a mailbox in a different organization', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox({ organizationId: otherOrgId }));

      await expect(service.getAssignees(orgId, 'mailbox_1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('setAssignees', () => {
    it('upserts the primary and secondary users and removes anyone no longer in the desired set', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      assignments.findByMailbox
        .mockResolvedValueOnce([buildAssignment({ userId: 'user_old', role: 'SECONDARY' })])
        .mockResolvedValueOnce([buildAssignment({ userId: 'user_1', role: 'PRIMARY' })]);
      users.findById.mockResolvedValue(buildUser());

      await service.setAssignees(
        orgId,
        'mailbox_1',
        { primaryUserId: 'user_1', secondaryUserIds: [] },
        'actor_1',
      );

      expect(assignments.remove).toHaveBeenCalledWith('mailbox_1', 'user_old');
      expect(assignments.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ mailboxId: 'mailbox_1', userId: 'user_1', role: 'PRIMARY' }),
      );
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'mailbox.assign',
          metadata: { primaryUserId: 'user_1', secondaryUserIds: [] },
        }),
      );
    });

    it('rejects a userId that does not belong to the organization, without assigning anything', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      users.findById.mockResolvedValue(buildUser({ organizationId: otherOrgId }));

      await expect(
        service.setAssignees(
          orgId,
          'mailbox_1',
          { primaryUserId: 'user_from_other_org', secondaryUserIds: [] },
          'actor_1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(assignments.upsert).not.toHaveBeenCalled();
    });

    it('rejects assigning an inactive executive', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      users.findById.mockResolvedValue(buildUser({ status: 'INACTIVE' }));

      await expect(
        service.setAssignees(
          orgId,
          'mailbox_1',
          { primaryUserId: 'user_1', secondaryUserIds: [] },
          'actor_1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(assignments.upsert).not.toHaveBeenCalled();
    });

    it('de-duplicates a secondary id that is also the primary', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      users.findById.mockResolvedValue(buildUser());

      await service.setAssignees(
        orgId,
        'mailbox_1',
        { primaryUserId: 'user_1', secondaryUserIds: ['user_1'] },
        'actor_1',
      );

      expect(assignments.upsert).toHaveBeenCalledTimes(1);
      expect(assignments.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user_1', role: 'PRIMARY' }),
      );
    });

    it('throws NotFoundException for a mailbox in a different organization (never 403)', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox({ organizationId: otherOrgId }));

      await expect(
        service.setAssignees(
          orgId,
          'mailbox_1',
          { primaryUserId: 'user_1', secondaryUserIds: [] },
          'actor_1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(assignments.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getAssignedMailboxesForUser', () => {
    it('returns only mailboxes assigned to that user, scoped to the organization', async () => {
      assignments.findByUser.mockResolvedValue([
        buildAssignment({ mailboxId: 'mailbox_1' }),
        buildAssignment({ mailboxId: 'mailbox_foreign' }),
      ]);
      mailboxes.findById.mockImplementation((id) =>
        Promise.resolve(
          id === 'mailbox_1'
            ? buildMailbox()
            : buildMailbox({ id: 'mailbox_foreign', organizationId: otherOrgId }),
        ),
      );

      const result = await service.getAssignedMailboxesForUser(orgId, 'user_1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('mailbox_1');
    });

    it('never includes IMAP/SMTP protocol details — executives only see identity fields', async () => {
      assignments.findByUser.mockResolvedValue([buildAssignment({ mailboxId: 'mailbox_1' })]);
      mailboxes.findById.mockResolvedValue(buildMailbox());

      const [result] = await service.getAssignedMailboxesForUser(orgId, 'user_1');

      expect(result).not.toHaveProperty('imap');
      expect(result).not.toHaveProperty('smtp');
      expect(JSON.stringify(result)).not.toContain('iv.tag.cipher');
    });
  });
});
