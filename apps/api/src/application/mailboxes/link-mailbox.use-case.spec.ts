import { ConflictException, GoneException, ServiceUnavailableException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MailboxMotorPort } from '../../domain/mailbox-motor/mailbox-motor-port';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { ClientsService } from '../clients/clients.service';
import { CrmClientEligibilityService } from '../crm-clients/crm-client-eligibility.service';
import { IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { ClientMailboxVisibilityService } from './client-mailbox-visibility.service';
import { LinkMailboxInput, LinkMailboxUseCase } from './link-mailbox.use-case';
import { MailboxExecutiveAssignmentValidator } from './mailbox-executive-assignment.validator';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('LinkMailboxUseCase', () => {
  let domains: jest.Mocked<DomainRepository>;
  let mailboxes: jest.Mocked<MailboxRepository>;
  let assignments: jest.Mocked<MailboxAssignmentRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let motor: jest.Mocked<MailboxMotorPort>;
  let clients: jest.Mocked<Pick<ClientsService, 'upsertFromVerifiedCrmClient'>>;
  let managedClients: jest.Mocked<Pick<ManagedClientRepository, 'findByServerClientId' | 'create'>>;
  let crmEligibility: jest.Mocked<Pick<CrmClientEligibilityService, 'getVerifiedActiveClient'>>;
  let idempotency: jest.Mocked<Pick<IdempotentOperationService, 'checkExisting' | 'claim' | 'markCompleted'>>;
  let executiveValidator: jest.Mocked<Pick<MailboxExecutiveAssignmentValidator, 'plan' | 'validate'>>;
  let clientVisibility: jest.Mocked<Pick<ClientMailboxVisibilityService, 'grantForExecutives' | 'revokeIfNoRemainingMailbox'>>;
  let useCase: LinkMailboxUseCase;

  const orgId = 'org_1';
  const crmClient = { crmClientId: 88, name: 'Cliente Ejemplo', rut: '76.111.222-3', rubro: 'Servicios', status: 'ACTIVO' };
  const managedClient = { id: 'mc_1', organizationId: orgId, crmClientId: 88 } as never;
  const domain = { id: 'domain_1', organizationId: orgId, clientId: 'mc_1', domainName: 'cliente.cl' };

  const redemption = {
    redemptionId: 'red_1',
    tokenId: 'tok_1',
    status: 'REDEEMED' as const,
    redeemedAt: new Date(),
    mailbox: { serverMailboxId: 'mbx_1', email: 'ventas@cliente.cl', displayName: 'Ventas', status: 'CONNECTED' as const, canSend: true },
    domain: { serverDomainId: 'dom_1', name: 'cliente.cl' },
    client: { serverClientId: 'client_1', crmClientId: 88, name: 'Cliente Ejemplo' },
  };

  function baseInput(overrides: Partial<LinkMailboxInput> = {}): LinkMailboxInput {
    return {
      organizationId: orgId,
      token: 'mmt_faketoken',
      primaryExecutiveId: 'exec_1',
      actorId: 'admin_1',
      idempotencyKey: 'client-key-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    domains = { findById: jest.fn(), findByClient: jest.fn(), findByName: jest.fn().mockResolvedValue(null), findAll: jest.fn(), create: jest.fn(), update: jest.fn() };
    mailboxes = { findById: jest.fn(), findByEmail: jest.fn(), findByServerMailboxId: jest.fn().mockResolvedValue(null), findAll: jest.fn(), create: jest.fn(), createLinked: jest.fn(), update: jest.fn() };
    assignments = { upsert: jest.fn(), remove: jest.fn(), findByMailbox: jest.fn(), findByUser: jest.fn(), findAllByOrganization: jest.fn().mockResolvedValue([]) };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    motor = {
      introspectLinkToken: jest.fn(),
      redeemLinkToken: jest.fn().mockResolvedValue(redemption),
      getMailboxStatus: jest.fn(),
      unlinkMailbox: jest.fn(),
    };
    clients = { upsertFromVerifiedCrmClient: jest.fn().mockResolvedValue(managedClient) };
    managedClients = { findByServerClientId: jest.fn().mockResolvedValue(null), create: jest.fn() };
    crmEligibility = { getVerifiedActiveClient: jest.fn().mockResolvedValue(crmClient) };
    idempotency = {
      checkExisting: jest.fn().mockResolvedValue(null),
      claim: jest.fn(),
      markCompleted: jest.fn().mockResolvedValue(undefined),
    };
    executiveValidator = {
      plan: jest.fn((primary?: string | null, secondary?: string[]) => {
        const primaryExecutiveId = primary ?? null;
        const secondaryExecutiveIds = [...new Set(secondary ?? [])].filter((id) => id !== primaryExecutiveId);
        return { primaryExecutiveId, secondaryExecutiveIds };
      }),
      validate: jest.fn().mockResolvedValue(undefined),
    };
    clientVisibility = { grantForExecutives: jest.fn().mockResolvedValue(undefined), revokeIfNoRemainingMailbox: jest.fn().mockResolvedValue(undefined) };

    domains.create.mockResolvedValue(domain as never);
    mailboxes.createLinked.mockResolvedValue({ id: 'mailbox_1', organizationId: orgId, email: 'ventas@cliente.cl' } as never);
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

    useCase = new LinkMailboxUseCase(
      new FakeTransactionManager(),
      domains,
      mailboxes,
      assignments,
      auditLogs,
      motor,
      managedClients as never,
      clients as never,
      crmEligibility as never,
      idempotency as never,
      executiveValidator as never,
      clientVisibility as never,
    );
  });

  it('links a mailbox successfully, creating client/domain/mailbox/assignment/audit/command', async () => {
    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(result.mailboxId).toBe('mailbox_1');
    expect(result.serverMailboxId).toBe('mbx_1');
    expect(result.linkStatus).toBe('ACTIVE');
    expect(clients.upsertFromVerifiedCrmClient).toHaveBeenCalledWith(orgId, crmClient, 'admin_1', {}, { kind: 'fake' });
    expect(domains.create).toHaveBeenCalled();
    expect(mailboxes.createLinked).toHaveBeenCalledWith(
      expect.objectContaining({ serverMailboxId: 'mbx_1', clientId: 'mc_1', domainId: 'domain_1' }),
      { kind: 'fake' },
    );
    expect(assignments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ mailboxId: 'mailbox_1', userId: 'exec_1', role: 'PRIMARY' }),
      { kind: 'fake' },
    );
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'mailbox.link' }), { kind: 'fake' });
    expect(idempotency.claim).toHaveBeenCalled();
    expect(idempotency.markCompleted).toHaveBeenCalledWith('row_1', { kind: 'fake' });
  });

  it('reuses the existing domain when it already belongs to the same client', async () => {
    domains.findByName.mockResolvedValue(domain as never);

    await useCase.execute(baseInput());

    expect(domains.create).not.toHaveBeenCalled();
  });

  it('rejects when the domain already belongs to a different client locally', async () => {
    domains.findByName.mockResolvedValue({ ...domain, clientId: 'other_client' } as never);

    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(mailboxes.createLinked).not.toHaveBeenCalled();
  });

  it('rejects when this serverMailboxId is already linked (race / different idempotency key)', async () => {
    mailboxes.findByServerMailboxId.mockResolvedValue({ id: 'existing_mailbox' } as never);

    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(mailboxes.createLinked).not.toHaveBeenCalled();
    expect(auditLogs.record).not.toHaveBeenCalled();
  });

  it('propagates 404 for a nonexistent executive (thrown by the shared validator)', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    executiveValidator.validate.mockRejectedValue(new NotFoundException('no existe'));

    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
    expect(mailboxes.createLinked).not.toHaveBeenCalled();
  });

  it('propagates 409 for an executive not authorized for the client', async () => {
    executiveValidator.validate.mockRejectedValue(new ConflictException('no autorizado'));

    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(mailboxes.createLinked).not.toHaveBeenCalled();
    expect(assignments.upsert).not.toHaveBeenCalled();
  });

  it('propagates GoneException for an expired/revoked token straight from the motor', async () => {
    motor.redeemLinkToken.mockRejectedValue(new GoneException('vencido'));

    await expect(useCase.execute(baseInput())).rejects.toThrow(GoneException);
    expect(mailboxes.createLinked).not.toHaveBeenCalled();
  });

  it('propagates 409 when the motor reports the token already redeemed by another organization', async () => {
    motor.redeemLinkToken.mockRejectedValue(new ConflictException('otra organización'));

    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
  });

  it('fails closed (503) when the motor is unavailable, never creating a local mailbox', async () => {
    motor.redeemLinkToken.mockRejectedValue(new ServiceUnavailableException('motor caído'));

    await expect(useCase.execute(baseInput())).rejects.toThrow(ServiceUnavailableException);
    expect(mailboxes.createLinked).not.toHaveBeenCalled();
  });

  it('returns the exact same result on a retry with the same Idempotency-Key and payload, never re-redeeming', async () => {
    const attempt = baseInput();

    const first = await useCase.execute(attempt);
    idempotency.checkExisting.mockResolvedValue({
      resultSnapshot: first.result,
      httpStatusCode: 201,
    } as never);
    const second = await useCase.execute(attempt);

    expect(second.result).toEqual(first.result);
    expect(mailboxes.createLinked).toHaveBeenCalledTimes(1);
  });

  it('never includes the raw token anywhere in the result or the command payload', async () => {
    const { result } = await useCase.execute(baseInput());

    expect(JSON.stringify(result)).not.toContain('mmt_faketoken');
    const claimCall = idempotency.claim.mock.calls[0][1];
    expect(JSON.stringify(claimCall)).not.toContain('mmt_faketoken');
  });

  it('links secondary executives alongside the primary and grants derived visibility to all of them', async () => {
    const { result } = await useCase.execute(baseInput({ secondaryExecutiveIds: ['exec_2', 'exec_3'] }));

    expect(result.secondaryExecutiveIds).toEqual(['exec_2', 'exec_3']);
    expect(assignments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'exec_2', role: 'SECONDARY' }),
      { kind: 'fake' },
    );
    expect(assignments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'exec_3', role: 'SECONDARY' }),
      { kind: 'fake' },
    );
    expect(clientVisibility.grantForExecutives).toHaveBeenCalledWith(
      orgId,
      'mc_1',
      ['exec_1', 'exec_2', 'exec_3'],
      'admin_1',
      { kind: 'fake' },
    );
  });

  it('§9.1 — links successfully for a client the motor reports without crmClientId, using serverClientId as the dedupe key instead', async () => {
    motor.redeemLinkToken.mockResolvedValue({
      ...redemption,
      client: { ...redemption.client, crmClientId: null },
    });
    const serverOnlyClient = { id: 'mc_server_1', organizationId: orgId, crmClientId: null, source: 'SERVER', serverClientId: 'client_1' };
    managedClients.create.mockResolvedValue(serverOnlyClient as never);

    const { result } = await useCase.execute(baseInput());

    expect(result.clientId).toBe('mc_server_1');
    expect(clients.upsertFromVerifiedCrmClient).not.toHaveBeenCalled();
    expect(crmEligibility.getVerifiedActiveClient).not.toHaveBeenCalled();
    expect(managedClients.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, crmClientId: null, source: 'SERVER', serverClientId: 'client_1' }),
      { kind: 'fake' },
    );
  });

  it('§9.1 — reuses the existing local client on a repeat redemption for the same Railway serverClientId', async () => {
    motor.redeemLinkToken.mockResolvedValue({
      ...redemption,
      client: { ...redemption.client, crmClientId: null },
    });
    const serverOnlyClient = { id: 'mc_server_1', organizationId: orgId, crmClientId: null, source: 'SERVER', serverClientId: 'client_1' };
    managedClients.findByServerClientId.mockResolvedValue(serverOnlyClient as never);

    const { result } = await useCase.execute(baseInput());

    expect(result.clientId).toBe('mc_server_1');
    expect(managedClients.create).not.toHaveBeenCalled();
  });
});
