import { ConflictException } from '@nestjs/common';
import { IntegrationCommand } from '../../domain/integration/integration-command.entity';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { IdempotentOperationService, IDEMPOTENCY_SCOPE, buildIdempotencyStorageKey } from './idempotent-operation.service';

describe('IdempotentOperationService', () => {
  let commands: jest.Mocked<IntegrationCommandRepository>;
  let service: IdempotentOperationService;

  const orgId = 'org_1';

  function buildCommand(overrides: Partial<IntegrationCommand> = {}): IntegrationCommand {
    return {
      id: 'row_1',
      organizationId: orgId,
      commandId: 'cmd_1',
      commandType: 'MAILBOX_CONFIGURE_REQUESTED' as never,
      aggregateType: 'MAILBOX',
      aggregateId: 'mailbox_1',
      schemaVersion: '1.0',
      idempotencyKey: buildIdempotencyStorageKey(IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE, 'client-key-1'),
      correlationId: 'corr_1',
      payload: {},
      status: 'REQUESTED',
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      requestedBy: 'admin_1',
      createdAt: new Date(),
      sentAt: null,
      acceptedAt: null,
      completedAt: null,
      payloadHash: 'hash-a',
      resultSnapshot: { mailboxId: 'mailbox_1' },
      httpStatusCode: 201,
      ...overrides,
    };
  }

  beforeEach(() => {
    commands = {
      findById: jest.fn(),
      findByCommandId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    service = new IdempotentOperationService(commands);
  });

  describe('checkExisting', () => {
    it('returns null when nothing has been claimed yet', async () => {
      commands.findByIdempotencyKey.mockResolvedValue(null);
      const result = await service.checkExisting(orgId, IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE, 'client-key-1', 'hash-a');
      expect(result).toBeNull();
      expect(commands.findByIdempotencyKey).toHaveBeenCalledWith(
        orgId,
        buildIdempotencyStorageKey(IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE, 'client-key-1'),
      );
    });

    it('returns the existing command when the payload hash matches (idempotent retry)', async () => {
      const existing = buildCommand({ payloadHash: 'hash-a' });
      commands.findByIdempotencyKey.mockResolvedValue(existing);
      const result = await service.checkExisting(orgId, IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE, 'client-key-1', 'hash-a');
      expect(result).toBe(existing);
    });

    it('throws 409 when the same key was used with a different payload hash', async () => {
      commands.findByIdempotencyKey.mockResolvedValue(buildCommand({ payloadHash: 'hash-a' }));
      await expect(
        service.checkExisting(orgId, IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE, 'client-key-1', 'hash-b'),
      ).rejects.toThrow(ConflictException);
    });

    it('never exposes the previous payload/result in the 409 error message', async () => {
      commands.findByIdempotencyKey.mockResolvedValue(
        buildCommand({ payloadHash: 'hash-a', resultSnapshot: { secretLookingField: 'should-not-leak' } }),
      );
      try {
        await service.checkExisting(orgId, IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE, 'client-key-1', 'hash-b');
        throw new Error('expected checkExisting to throw');
      } catch (error) {
        expect((error as Error).message).not.toContain('should-not-leak');
      }
    });

    it('scopes the same raw key differently across operation types (no cross-scope collision)', async () => {
      await service.checkExisting(orgId, IDEMPOTENCY_SCOPE.SEQUENCE_PUBLISH, 'client-key-1', 'hash-a').catch(() => {});
      expect(commands.findByIdempotencyKey).toHaveBeenCalledWith(
        orgId,
        buildIdempotencyStorageKey(IDEMPOTENCY_SCOPE.SEQUENCE_PUBLISH, 'client-key-1'),
      );
    });
  });

  describe('claim', () => {
    it('persists the command with the scoped key, payloadHash, resultSnapshot and httpStatusCode', async () => {
      commands.create.mockResolvedValue(buildCommand());
      await service.claim(
        { kind: 'memory' },
        {
          organizationId: orgId,
          scope: IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE,
          rawIdempotencyKey: 'client-key-1',
          payloadHash: 'hash-a',
          commandType: 'MAILBOX_CONFIGURE_REQUESTED',
          aggregateType: 'MAILBOX',
          aggregateId: 'mailbox_1',
          correlationId: 'corr_1',
          requestedBy: 'admin_1',
          commandPayload: { mailboxId: 'mailbox_1' },
        },
        { mailboxId: 'mailbox_1' },
        201,
      );

      expect(commands.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          idempotencyKey: buildIdempotencyStorageKey(IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE, 'client-key-1'),
          payloadHash: 'hash-a',
          resultSnapshot: { mailboxId: 'mailbox_1' },
          httpStatusCode: 201,
          aggregateType: 'MAILBOX',
          aggregateId: 'mailbox_1',
        }),
        { kind: 'memory' },
      );
    });
  });
});
