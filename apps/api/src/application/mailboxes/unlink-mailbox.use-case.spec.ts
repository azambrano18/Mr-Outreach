import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MailboxMotorPort } from '../../domain/mailbox-motor/mailbox-motor-port';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { ClientMailboxVisibilityService } from './client-mailbox-visibility.service';
import { RemoveMailboxAssignmentsAfterUnlinkUseCase } from './remove-mailbox-assignments-after-unlink.use-case';
import { UnlinkMailboxInput, UnlinkMailboxUseCase } from './unlink-mailbox.use-case';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('UnlinkMailboxUseCase', () => {
  let mailboxes: jest.Mocked<MailboxRepository>;
  let scheduledEmails: jest.Mocked<Pick<ScheduledEmailRepository, 'cancelFutureForMailbox'>>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let motor: jest.Mocked<MailboxMotorPort>;
  let assignments: jest.Mocked<Pick<MailboxAssignmentRepository, 'findByMailbox'>>;
  let sequenceExecutions: jest.Mocked<Pick<SequenceExecutionRepository, 'findAllByOrganization'>>;
  let idempotency: jest.Mocked<Pick<IdempotentOperationService, 'checkExisting' | 'claim' | 'markCompleted'>>;
  let clientVisibility: jest.Mocked<Pick<ClientMailboxVisibilityService, 'grantForExecutives' | 'revokeIfNoRemainingMailbox'>>;
  let removeAssignmentsAfterUnlink: jest.Mocked<Pick<RemoveMailboxAssignmentsAfterUnlinkUseCase, 'execute'>>;
  let useCase: UnlinkMailboxUseCase;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';
  const activeMailbox = {
    id: 'mailbox_1',
    organizationId: orgId,
    clientId: 'mc_1',
    linkSource: 'SERVER_TOKEN',
    linkStatus: 'ACTIVE',
    serverMailboxId: 'mbx_1',
    revocationId: null,
    unlinkReason: null,
    unlinkRemoveAssignments: false,
  };

  function baseInput(overrides: Partial<UnlinkMailboxInput> = {}): UnlinkMailboxInput {
    return {
      organizationId: orgId,
      mailboxId: 'mailbox_1',
      reason: 'Cuenta dada de baja',
      actorId: 'admin_1',
      idempotencyKey: 'client-key-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    mailboxes = {
      findById: jest.fn().mockResolvedValue(activeMailbox),
      findByIdIncludingDeleted: jest.fn(),
      findByEmail: jest.fn(),
      findByServerMailboxId: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      createLinked: jest.fn(),
      update: jest.fn().mockImplementation(async (_id, patch) => ({ ...activeMailbox, ...patch })),
    };
    scheduledEmails = { cancelFutureForMailbox: jest.fn().mockResolvedValue(3) };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    motor = {
      introspectLinkToken: jest.fn(),
      redeemLinkToken: jest.fn(),
      getMailboxStatus: jest.fn(),
      unlinkMailbox: jest.fn().mockResolvedValue({
        serverMailboxId: 'mbx_1',
        status: 'REVOKED',
        revocationId: 'rev_1',
        revokedAt: new Date(),
      }),
    };
    assignments = { findByMailbox: jest.fn().mockResolvedValue([]) };
    sequenceExecutions = { findAllByOrganization: jest.fn().mockResolvedValue([]) };
    clientVisibility = { grantForExecutives: jest.fn().mockResolvedValue(undefined), revokeIfNoRemainingMailbox: jest.fn().mockResolvedValue(undefined) };
    removeAssignmentsAfterUnlink = {
      execute: jest.fn().mockResolvedValue({ mailboxId: 'mailbox_1', assignmentsRemoved: 0, primaryRemoved: null, secondaryRemoved: [] }),
    };
    idempotency = {
      checkExisting: jest.fn().mockResolvedValue(null),
      claim: jest.fn(),
      markCompleted: jest.fn().mockResolvedValue(undefined),
    };
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

    useCase = new UnlinkMailboxUseCase(
      new FakeTransactionManager(),
      mailboxes,
      scheduledEmails as never,
      auditLogs,
      motor,
      assignments as never,
      sequenceExecutions as never,
      idempotency as never,
      clientVisibility as never,
      removeAssignmentsAfterUnlink as never,
    );
  });

  it('cancels future jobs, requests unlink, and confirms REVOKED when the motor succeeds', async () => {
    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(200);
    expect(result.linkStatus).toBe('REVOKED');
    expect(result.revocationId).toBe('rev_1');
    expect(result.cancelledJobsCount).toBe(3);
    expect(scheduledEmails.cancelFutureForMailbox).toHaveBeenCalledWith('mailbox_1', 'Cuenta dada de baja', { kind: 'fake' });
    expect(mailboxes.update).toHaveBeenCalledWith(
      'mailbox_1',
      expect.objectContaining({ linkStatus: 'UNLINK_REQUESTED' }),
      { kind: 'fake' },
    );
    expect(mailboxes.update).toHaveBeenCalledWith('mailbox_1', expect.objectContaining({ linkStatus: 'REVOKED', revocationId: 'rev_1' }));
    expect(idempotency.markCompleted).toHaveBeenCalledWith('row_1');
  });

  it('requires a non-empty reason', async () => {
    await expect(useCase.execute(baseInput({ reason: '   ' }))).rejects.toThrow(BadRequestException);
    expect(mailboxes.update).not.toHaveBeenCalled();
  });

  it('404s for a nonexistent mailbox', async () => {
    mailboxes.findById.mockResolvedValue(null);
    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('rejects unlinking a LEGACY_LOCAL mailbox (no motor link to revoke)', async () => {
    mailboxes.findById.mockResolvedValue({ ...activeMailbox, linkSource: 'LEGACY_LOCAL' } as never);
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
  });

  it('is an idempotent no-op success when the mailbox is already REVOKED', async () => {
    mailboxes.findById.mockResolvedValue({ ...activeMailbox, linkStatus: 'REVOKED', revocationId: 'rev_old' } as never);

    const { result } = await useCase.execute(baseInput({ idempotencyKey: 'a-new-different-key' }));

    expect(result.linkStatus).toBe('REVOKED');
    expect(result.revocationId).toBe('rev_old');
    expect(scheduledEmails.cancelFutureForMailbox).not.toHaveBeenCalled();
    expect(motor.unlinkMailbox).not.toHaveBeenCalled();
  });

  it('stays UNLINK_REQUESTED (never REVOKED) when the motor confirmation fails, without creating a second command, and audits the failure', async () => {
    motor.unlinkMailbox.mockRejectedValue(new ServiceUnavailableException('motor caído'));

    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(200);
    expect(result.linkStatus).toBe('UNLINK_REQUESTED');
    expect(result.revocationId).toBeNull();
    expect(idempotency.claim).toHaveBeenCalledTimes(1);
    expect(idempotency.markCompleted).not.toHaveBeenCalled();
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mailbox.unlink_failed', entityId: 'mailbox_1' }),
    );
  });

  it('Fase 11 — records the ACCEPTED and PROCESSING audit stages around the motor call, in addition to REQUESTED and the terminal stage', async () => {
    await useCase.execute(baseInput());

    const actions = auditLogs.record.mock.calls.map((call) => call[0].action);
    expect(actions).toEqual([
      'mailbox.unlink_requested',
      'mailbox.unlink_accepted',
      'mailbox.unlink_processing',
      'mailbox.unlink_confirmed',
    ]);
  });

  it('records ACCEPTED and PROCESSING even when the motor ultimately fails, before the FAILED entry', async () => {
    motor.unlinkMailbox.mockRejectedValue(new ServiceUnavailableException('motor caído'));

    await useCase.execute(baseInput());

    const actions = auditLogs.record.mock.calls.map((call) => call[0].action);
    expect(actions).toEqual([
      'mailbox.unlink_requested',
      'mailbox.unlink_accepted',
      'mailbox.unlink_processing',
      'mailbox.unlink_failed',
    ]);
  });

  it('rejects unlinking a mailbox that belongs to a different organization (never 403 — same 404 as "does not exist")', async () => {
    mailboxes.findById.mockResolvedValue({ ...activeMailbox, organizationId: otherOrgId } as never);

    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
    expect(mailboxes.update).not.toHaveBeenCalled();
    expect(motor.unlinkMailbox).not.toHaveBeenCalled();
  });

  it('§10 — revoke-checks derived visibility for every assignee once the motor confirms REVOKED', async () => {
    assignments.findByMailbox.mockResolvedValue([
      { id: 'a1', mailboxId: 'mailbox_1', userId: 'exec_1', role: 'PRIMARY' } as never,
    ]);

    await useCase.execute(baseInput());

    expect(clientVisibility.revokeIfNoRemainingMailbox).toHaveBeenCalledWith(orgId, 'mc_1', 'exec_1');
  });

  it('never reactivates the account or re-cancels jobs when the local transaction already committed but the motor call fails', async () => {
    motor.unlinkMailbox.mockRejectedValue(new ServiceUnavailableException('motor caído'));

    await useCase.execute(baseInput());

    // Only ever cancelled once, in the local transaction — never repeated post-commit.
    expect(scheduledEmails.cancelFutureForMailbox).toHaveBeenCalledTimes(1);
  });

  it('returns the exact same result on a retry with the same Idempotency-Key and payload', async () => {
    const attempt = baseInput();
    const first = await useCase.execute(attempt);
    idempotency.checkExisting.mockResolvedValue({ resultSnapshot: first.result, httpStatusCode: 200 } as never);

    const second = await useCase.execute(attempt);

    expect(second.result).toEqual(first.result);
    expect(scheduledEmails.cancelFutureForMailbox).toHaveBeenCalledTimes(1);
  });

  describe('retryConfirmation', () => {
    it('confirms REVOKED on retry when the motor now succeeds', async () => {
      mailboxes.findById.mockResolvedValue({ ...activeMailbox, linkStatus: 'UNLINK_REQUESTED', unlinkReason: 'motivo previo' } as never);

      const result = await useCase.retryConfirmation(orgId, 'mailbox_1', 'admin_1');

      expect(result.linkStatus).toBe('REVOKED');
      expect(result.revocationId).toBe('rev_1');
    });

    it('rejects retrying a mailbox that is not in UNLINK_REQUESTED', async () => {
      mailboxes.findById.mockResolvedValue({ ...activeMailbox, linkStatus: 'ACTIVE' } as never);

      await expect(useCase.retryConfirmation(orgId, 'mailbox_1', 'admin_1')).rejects.toThrow(ConflictException);
    });

    it('is a no-op success when already REVOKED', async () => {
      mailboxes.findById.mockResolvedValue({ ...activeMailbox, linkStatus: 'REVOKED', revocationId: 'rev_old' } as never);

      const result = await useCase.retryConfirmation(orgId, 'mailbox_1', 'admin_1');

      expect(result.linkStatus).toBe('REVOKED');
      expect(motor.unlinkMailbox).not.toHaveBeenCalled();
    });

    it('never regresses an already-REVOKED mailbox back to UNLINK_REQUESTED — a late/duplicate retry can only confirm, never undo', async () => {
      mailboxes.findById.mockResolvedValue({ ...activeMailbox, linkStatus: 'REVOKED', revocationId: 'rev_old' } as never);

      await useCase.retryConfirmation(orgId, 'mailbox_1', 'admin_1');

      expect(mailboxes.update).not.toHaveBeenCalled();
    });

    it('rejects retrying a mailbox that belongs to a different organization (never 403 — same 404 as "does not exist")', async () => {
      mailboxes.findById.mockResolvedValue({ ...activeMailbox, organizationId: otherOrgId, linkStatus: 'UNLINK_REQUESTED' } as never);

      await expect(useCase.retryConfirmation(orgId, 'mailbox_1', 'admin_1')).rejects.toThrow(NotFoundException);
      expect(motor.unlinkMailbox).not.toHaveBeenCalled();
    });
  });

  describe('§4 — Gestiones activas block unlinking', () => {
    it.each(['RUNNING', 'PAUSE_REQUESTED', 'PAUSED', 'RESUME_REQUESTED', 'STOP_REQUESTED', 'RESTART_REQUESTED'])(
      'rejects unlinking while a Gestión on this mailbox is %s',
      async (status) => {
        sequenceExecutions.findAllByOrganization.mockResolvedValue([
          { id: 'exec_1', mailboxId: 'mailbox_1', status } as never,
        ]);

        await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
        expect(mailboxes.update).not.toHaveBeenCalled();
        expect(motor.unlinkMailbox).not.toHaveBeenCalled();
      },
    );

    it('a Gestión on a DIFFERENT mailbox never blocks this one', async () => {
      sequenceExecutions.findAllByOrganization.mockResolvedValue([
        { id: 'exec_1', mailboxId: 'some-other-mailbox', status: 'RUNNING' } as never,
      ]);

      await expect(useCase.execute(baseInput())).resolves.toBeTruthy();
    });

    it.each(['STOPPED', 'COMPLETED', 'FAILED', 'REJECTED', 'DRAFT'])(
      'a %s Gestión never blocks unlinking',
      async (status) => {
        sequenceExecutions.findAllByOrganization.mockResolvedValue([
          { id: 'exec_1', mailboxId: 'mailbox_1', status } as never,
        ]);

        await expect(useCase.execute(baseInput())).resolves.toBeTruthy();
      },
    );
  });

  describe('§1/§3/§6 — removing assignments after a confirmed unlink', () => {
    it('never removes assignments before REVOKED is confirmed, even when authorized', async () => {
      motor.unlinkMailbox.mockRejectedValue(new ServiceUnavailableException('motor caído'));

      const { result } = await useCase.execute(baseInput({ removeAssignmentsAfterUnlink: true }));

      expect(result.linkStatus).toBe('UNLINK_REQUESTED');
      expect(removeAssignmentsAfterUnlink.execute).not.toHaveBeenCalled();
    });

    it('removes assignments once REVOKED is confirmed, only when the admin authorized it', async () => {
      await useCase.execute(baseInput({ removeAssignmentsAfterUnlink: true }));

      expect(removeAssignmentsAfterUnlink.execute).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' }),
      );
    });

    it('never removes assignments on a successful unlink when the admin did NOT authorize it', async () => {
      await useCase.execute(baseInput({ removeAssignmentsAfterUnlink: false }));

      expect(removeAssignmentsAfterUnlink.execute).not.toHaveBeenCalled();
    });

    it('persists the authorization flag on the UNLINK_REQUESTED transition, so a later retry can read it back', async () => {
      await useCase.execute(baseInput({ removeAssignmentsAfterUnlink: true }));

      expect(mailboxes.update).toHaveBeenCalledWith(
        'mailbox_1',
        expect.objectContaining({ linkStatus: 'UNLINK_REQUESTED', unlinkRemoveAssignments: true }),
        { kind: 'fake' },
      );
    });

    it('retryConfirmation reads the persisted authorization and removes assignments on success', async () => {
      mailboxes.findById.mockResolvedValue({
        ...activeMailbox,
        linkStatus: 'UNLINK_REQUESTED',
        unlinkReason: 'motivo previo',
        unlinkRemoveAssignments: true,
      } as never);

      await useCase.retryConfirmation(orgId, 'mailbox_1', 'admin_1');

      expect(removeAssignmentsAfterUnlink.execute).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: orgId, mailboxId: 'mailbox_1' }),
      );
    });

    it('retryConfirmation never removes assignments when the original request never authorized it', async () => {
      mailboxes.findById.mockResolvedValue({
        ...activeMailbox,
        linkStatus: 'UNLINK_REQUESTED',
        unlinkReason: 'motivo previo',
        unlinkRemoveAssignments: false,
      } as never);

      await useCase.retryConfirmation(orgId, 'mailbox_1', 'admin_1');

      expect(removeAssignmentsAfterUnlink.execute).not.toHaveBeenCalled();
    });
  });

  describe('§9 — reconciling residual assignments on an already-REVOKED mailbox', () => {
    it('a repeat unlink request against an already-REVOKED mailbox reconciles residual assignments when authorized', async () => {
      mailboxes.findById.mockResolvedValue({ ...activeMailbox, linkStatus: 'REVOKED', revocationId: 'rev_old' } as never);

      await useCase.execute(baseInput({ idempotencyKey: 'a-new-different-key', removeAssignmentsAfterUnlink: true }));

      expect(removeAssignmentsAfterUnlink.execute).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: orgId, mailboxId: 'mailbox_1' }),
      );
    });

    it('an already-REVOKED mailbox with no authorization stays untouched (no reconciliation attempted)', async () => {
      mailboxes.findById.mockResolvedValue({ ...activeMailbox, linkStatus: 'REVOKED', revocationId: 'rev_old' } as never);

      await useCase.execute(baseInput({ idempotencyKey: 'a-new-different-key' }));

      expect(removeAssignmentsAfterUnlink.execute).not.toHaveBeenCalled();
    });
  });
});
