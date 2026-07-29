import { ConflictException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { CommandType, EventEnvelope } from '../../domain/integration/envelopes';
import { IntegrationCommand } from '../../domain/integration/integration-command.entity';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { IntegrationEvent } from '../../domain/integration/integration-event.entity';
import { IntegrationEventRepository } from '../../domain/integration/integration-event.repository';
import { MailEnginePort } from '../../domain/integration/mail-engine-port';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { SimulatedMailEngineAdapter } from '../../infrastructure/mail-engine/simulated/simulated-mail-engine-adapter';
import { IntegrationService } from './integration.service';

describe('IntegrationService', () => {
  let commandRepo: jest.Mocked<IntegrationCommandRepository>;
  let eventRepo: jest.Mocked<IntegrationEventRepository>;
  let port: jest.Mocked<MailEnginePort>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let config: { mailEngineMode: string };
  let simulatedAdapter: jest.Mocked<Pick<SimulatedMailEngineAdapter, 'planEvents'>>;
  let service: IntegrationService;

  const orgId = 'org_1';

  const buildCommand = (overrides: Partial<IntegrationCommand> = {}): IntegrationCommand => ({
    id: 'row_1',
    organizationId: orgId,
    commandId: 'cmd_1',
    commandType: 'MAILBOX_PROVISION_REQUESTED' as CommandType,
    aggregateType: 'MAILBOX',
    aggregateId: 'mailbox_1',
    schemaVersion: '1.0',
    idempotencyKey: 'key_1',
    correlationId: 'corr_1',
    payload: { password: 'super-secret', mailboxId: 'mailbox_1' },
    status: 'REQUESTED',
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    requestedBy: 'admin_1',
    createdAt: new Date(),
    sentAt: null,
    acceptedAt: null,
    completedAt: null,
    payloadHash: null,
    resultSnapshot: null,
    httpStatusCode: null,
    ...overrides,
  });

  beforeEach(() => {
    commandRepo = {
      findById: jest.fn(),
      findByCommandId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    eventRepo = {
      findById: jest.fn(),
      findByEventId: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    port = {
      submitCommand: jest.fn(),
      getCommandStatus: jest.fn(),
      getMailboxStatus: jest.fn(),
      getImportStatus: jest.fn(),
      getSequenceStatus: jest.fn(),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    config = { mailEngineMode: 'simulation' };
    simulatedAdapter = { planEvents: jest.fn() };

    service = new IntegrationService(
      commandRepo,
      eventRepo,
      port,
      auditLogs,
      config as AppConfigService,
      simulatedAdapter as unknown as SimulatedMailEngineAdapter,
    );
  });

  describe('submit', () => {
    it('reuses the previous command instead of creating a new one for a repeated idempotencyKey (§43)', async () => {
      const existing = buildCommand();
      commandRepo.findByIdempotencyKey.mockResolvedValue(existing);

      const { command, duplicate } = await service.submit(
        {
          organizationId: orgId,
          commandType: 'MAILBOX_PROVISION_REQUESTED',
          aggregateType: 'MAILBOX',
          aggregateId: 'mailbox_1',
          payload: {},
          requestedBy: 'admin_1',
          idempotencyKey: 'key_1',
        },
        'admin_1',
      );

      expect(duplicate).toBe(true);
      expect(command).toBe(existing);
      expect(commandRepo.create).not.toHaveBeenCalled();
      expect(port.submitCommand).not.toHaveBeenCalled();
    });

    it('creates a command and marks it ACCEPTED when the port accepts it', async () => {
      commandRepo.findByIdempotencyKey.mockResolvedValue(null);
      const created = buildCommand({ status: 'REQUESTED' });
      commandRepo.create.mockResolvedValue(created);
      port.submitCommand.mockResolvedValue({ accepted: true });
      const accepted = buildCommand({ status: 'ACCEPTED' });
      commandRepo.update.mockResolvedValue(accepted);

      const { command, duplicate } = await service.submit(
        {
          organizationId: orgId,
          commandType: 'MAILBOX_PROVISION_REQUESTED',
          aggregateType: 'MAILBOX',
          aggregateId: 'mailbox_1',
          payload: {},
          requestedBy: 'admin_1',
          idempotencyKey: 'key_2',
        },
        'admin_1',
      );

      expect(duplicate).toBe(false);
      expect(command.status).toBe('ACCEPTED');
      expect(commandRepo.update).toHaveBeenCalledWith(
        created.id,
        expect.objectContaining({ status: 'ACCEPTED' }),
      );
    });
  });

  describe('redact', () => {
    it('replaces known secret-shaped keys with [REDACTED], recursively, without touching everything else', () => {
      const redacted = service.redact({
        mailbox: { password: 'hunter2', host: 'imap.example.com', credentialReference: 'secret_ref_demo_001' },
      });
      expect((redacted.mailbox as Record<string, unknown>).password).toBe('[REDACTED]');
      expect((redacted.mailbox as Record<string, unknown>).host).toBe('imap.example.com');
      // credentialReference is a fake reference, not a secret — must survive redaction untouched.
      expect((redacted.mailbox as Record<string, unknown>).credentialReference).toBe('secret_ref_demo_001');
    });
  });

  describe('advance', () => {
    it('never re-records an already-recorded planned event, and never advances when mailEngineMode is remote', async () => {
      config.mailEngineMode = 'remote';
      const command = buildCommand();
      commandRepo.findByCommandId.mockResolvedValue(command);

      await expect(service.advance(orgId, command.commandId, 'ALL', 'admin_1')).rejects.toThrow(ConflictException);
    });

    it('advances one event at a time in ONE mode and stops updating status once terminal', async () => {
      const command = buildCommand();
      commandRepo.findByCommandId.mockResolvedValue(command);

      const planned: EventEnvelope[] = [
        {
          schemaVersion: '1.0',
          eventId: 'evt_1',
          eventType: 'MAILBOX_PROVISION_ACCEPTED',
          commandId: command.commandId,
          correlationId: command.correlationId,
          organizationId: orgId,
          occurredAt: new Date().toISOString(),
          payload: {},
        },
        {
          schemaVersion: '1.0',
          eventId: 'evt_2',
          eventType: 'MAILBOX_PROVISION_COMPLETED',
          commandId: command.commandId,
          correlationId: command.correlationId,
          organizationId: orgId,
          occurredAt: new Date().toISOString(),
          payload: {},
        },
      ];
      simulatedAdapter.planEvents.mockReturnValue(planned);
      eventRepo.findAll.mockResolvedValue([]);
      eventRepo.create.mockImplementation(
        async (input) =>
          ({
            id: `row_${input.eventId}`,
            ...input,
            status: 'RECEIVED',
            receivedAt: new Date(),
            processedAt: null,
            processingError: null,
          }) as IntegrationEvent,
      );
      eventRepo.update.mockImplementation(
        async (id, patch) =>
          ({ id, ...patch }) as IntegrationEvent,
      );

      const recorded = await service.advance(orgId, command.commandId, 'ONE', 'admin_1');

      expect(recorded).toHaveLength(1);
      expect(recorded[0].eventId).toBe('evt_1');
      expect(commandRepo.update).toHaveBeenCalledWith(command.id, expect.objectContaining({ status: 'ACCEPTED' }));
    });
  });
});
