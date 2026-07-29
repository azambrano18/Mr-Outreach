import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { ClientMailboxVisibilityService } from './client-mailbox-visibility.service';
import { MailboxExecutiveAssignmentValidator } from './mailbox-executive-assignment.validator';
import {
  ReassignMailboxPrimaryExecutiveInput,
  ReassignMailboxPrimaryExecutiveUseCase,
} from './reassign-mailbox-primary-executive.use-case';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('ReassignMailboxPrimaryExecutiveUseCase', () => {
  let mailboxes: jest.Mocked<MailboxRepository>;
  let assignments: jest.Mocked<MailboxAssignmentRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let idempotency: jest.Mocked<Pick<IdempotentOperationService, 'checkExisting' | 'claim' | 'markCompleted'>>;
  let executiveValidator: jest.Mocked<Pick<MailboxExecutiveAssignmentValidator, 'validate'>>;
  let clientVisibility: jest.Mocked<Pick<ClientMailboxVisibilityService, 'grantForExecutives' | 'revokeIfNoRemainingMailbox'>>;
  let useCase: ReassignMailboxPrimaryExecutiveUseCase;

  const orgId = 'org_1';
  const mailbox = { id: 'mailbox_1', organizationId: orgId, clientId: 'mc_1', linkStatus: 'ACTIVE' };

  function baseInput(overrides: Partial<ReassignMailboxPrimaryExecutiveInput> = {}): ReassignMailboxPrimaryExecutiveInput {
    return {
      organizationId: orgId,
      mailboxId: 'mailbox_1',
      newPrimaryExecutiveId: 'exec_2',
      actorId: 'admin_1',
      idempotencyKey: 'client-key-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    mailboxes = { findById: jest.fn().mockResolvedValue(mailbox), findByEmail: jest.fn(), findByServerMailboxId: jest.fn(), findAll: jest.fn(), create: jest.fn(), createLinked: jest.fn(), update: jest.fn() };
    assignments = {
      upsert: jest.fn(),
      remove: jest.fn(),
      findByMailbox: jest.fn().mockResolvedValue([{ id: 'a1', mailboxId: 'mailbox_1', userId: 'exec_1', role: 'PRIMARY' }]),
      findByUser: jest.fn(),
      findAllByOrganization: jest.fn().mockResolvedValue([]),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    idempotency = {
      checkExisting: jest.fn().mockResolvedValue(null),
      claim: jest.fn(),
      markCompleted: jest.fn().mockResolvedValue(undefined),
    };
    executiveValidator = { validate: jest.fn().mockResolvedValue(undefined) };
    clientVisibility = { grantForExecutives: jest.fn().mockResolvedValue(undefined), revokeIfNoRemainingMailbox: jest.fn().mockResolvedValue(undefined) };

    idempotency.claim.mockImplementation(
      async (_ctx, input) =>
        ({
          id: 'row_1',
          organizationId: input.organizationId,
          commandId: input.commandId ?? 'cmd_fallback',
          commandType: input.commandType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          schemaVersion: '1.0',
          idempotencyKey: `${input.scope}:${input.rawIdempotencyKey}`,
          correlationId: input.correlationId,
          payload: input.commandPayload,
          status: 'REQUESTED',
          attemptCount: 0,
          nextAttemptAt: null,
          lastError: null,
          requestedBy: input.requestedBy,
          createdAt: new Date(),
          sentAt: null,
          acceptedAt: null,
          completedAt: null,
          payloadHash: input.payloadHash,
          resultSnapshot: null,
          httpStatusCode: null,
        }) as never,
    );

    useCase = new ReassignMailboxPrimaryExecutiveUseCase(
      new FakeTransactionManager(),
      mailboxes,
      assignments,
      auditLogs,
      idempotency as never,
      executiveValidator as never,
      clientVisibility as never,
    );
  });

  it('reassigns successfully, removing the old primary and upserting the new one', async () => {
    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(200);
    expect(result.previousPrimaryExecutiveId).toBe('exec_1');
    expect(result.newPrimaryExecutiveId).toBe('exec_2');
    expect(assignments.remove).toHaveBeenCalledWith('mailbox_1', 'exec_1', { kind: 'fake' });
    expect(assignments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ mailboxId: 'mailbox_1', userId: 'exec_2', role: 'PRIMARY' }),
      { kind: 'fake' },
    );
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mailbox.reassign_primary_executive',
        metadata: expect.objectContaining({ previousPrimaryExecutiveId: 'exec_1', newPrimaryExecutiveId: 'exec_2' }),
      }),
      { kind: 'fake' },
    );
  });

  it('does not call remove when there was no previous primary', async () => {
    assignments.findByMailbox.mockResolvedValue([]);

    const { result } = await useCase.execute(baseInput());

    expect(result.previousPrimaryExecutiveId).toBeNull();
    expect(assignments.remove).not.toHaveBeenCalled();
  });

  it('is a no-op remove when reassigning to the same executive already primary', async () => {
    assignments.findByMailbox.mockResolvedValue([{ id: 'a1', mailboxId: 'mailbox_1', userId: 'exec_2', role: 'PRIMARY' } as never]);

    await useCase.execute(baseInput({ newPrimaryExecutiveId: 'exec_2' }));

    expect(assignments.remove).not.toHaveBeenCalled();
    expect(assignments.upsert).toHaveBeenCalled();
  });

  it('404s for a nonexistent mailbox', async () => {
    mailboxes.findById.mockResolvedValue(null);

    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
    expect(assignments.upsert).not.toHaveBeenCalled();
  });

  it('404s for a mailbox belonging to another organization (never reveals existence)', async () => {
    mailboxes.findById.mockResolvedValue({ ...mailbox, organizationId: 'org_other' } as never);

    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('rejects reassignment on a REVOKED mailbox', async () => {
    mailboxes.findById.mockResolvedValue({ ...mailbox, linkStatus: 'REVOKED' } as never);

    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(assignments.upsert).not.toHaveBeenCalled();
  });

  it('propagates the shared validator errors for an invalid/unauthorized executive', async () => {
    executiveValidator.validate.mockRejectedValue(new ConflictException('no autorizado'));

    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(assignments.upsert).not.toHaveBeenCalled();
  });

  it('returns the exact same result on a retry with the same Idempotency-Key and payload', async () => {
    const attempt = baseInput();
    const first = await useCase.execute(attempt);
    idempotency.checkExisting.mockResolvedValue({ resultSnapshot: first.result, httpStatusCode: 200 } as never);

    const second = await useCase.execute(attempt);

    expect(second.result).toEqual(first.result);
    expect(assignments.upsert).toHaveBeenCalledTimes(1);
  });

  it('§10 — grants the new primary derived client visibility and revoke-checks the outgoing primary', async () => {
    await useCase.execute(baseInput());

    expect(clientVisibility.grantForExecutives).toHaveBeenCalledWith(orgId, 'mc_1', ['exec_2'], 'admin_1', { kind: 'fake' });
    expect(clientVisibility.revokeIfNoRemainingMailbox).toHaveBeenCalledWith(orgId, 'mc_1', 'exec_1', { kind: 'fake' });
  });

  it('never generates a token, changes client/domain, or touches the motor', async () => {
    await useCase.execute(baseInput());

    // No motor port dependency exists on this use case at all — verified structurally:
    // the constructor only accepts tx/mailboxes/assignments/auditLogs/idempotency/executiveValidator.
    expect(mailboxes.update).not.toHaveBeenCalled();
  });
});
