import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { UserRepository } from '../../domain/user/user.repository';
import { CrmClientEligibilityService } from '../crm-clients/crm-client-eligibility.service';
import { SequenceEligibilityService } from './sequence-eligibility.service';

describe('SequenceEligibilityService', () => {
  const orgId = 'org_1';
  let managedClients: jest.Mocked<ManagedClientRepository>;
  let domains: jest.Mocked<DomainRepository>;
  let mailboxes: jest.Mocked<MailboxRepository>;
  let mailboxAssignments: jest.Mocked<MailboxAssignmentRepository>;
  let clientAssignments: jest.Mocked<ClientExecutiveAssignmentRepository>;
  let users: jest.Mocked<UserRepository>;
  let crmEligibility: jest.Mocked<Pick<CrmClientEligibilityService, 'getVerifiedActiveClient'>>;
  let service: SequenceEligibilityService;

  beforeEach(() => {
    managedClients = { findById: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn(), findByCrmClientId: jest.fn(), findByServerClientId: jest.fn() };
    domains = { findById: jest.fn(), findByClient: jest.fn(), findByName: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() };
    mailboxes = { findById: jest.fn(), findByEmail: jest.fn(), findByServerMailboxId: jest.fn(), findAll: jest.fn(), create: jest.fn(), createLinked: jest.fn(), update: jest.fn() };
    mailboxAssignments = { upsert: jest.fn(), remove: jest.fn(), findByMailbox: jest.fn().mockResolvedValue([]), findByUser: jest.fn(), findAllByOrganization: jest.fn().mockResolvedValue([]) };
    clientAssignments = { upsert: jest.fn(), remove: jest.fn(), findByClient: jest.fn(), findByUser: jest.fn().mockResolvedValue([{ clientId: 'client_1' }]) } as never;
    users = { findById: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn(), findByEmail: jest.fn() } as never;
    crmEligibility = { getVerifiedActiveClient: jest.fn().mockResolvedValue({ crmClientId: 7, status: 'ACTIVO' }) };

    users.findById.mockResolvedValue({ id: 'exec_1', organizationId: orgId, status: 'ACTIVE' } as never);
    managedClients.findById.mockResolvedValue({ id: 'client_1', organizationId: orgId, crmClientId: 7, status: 'ACTIVE' } as never);
    domains.findById.mockResolvedValue({ id: 'domain_1', organizationId: orgId, clientId: 'client_1', status: 'ACTIVE' } as never);
    mailboxes.findById.mockResolvedValue({
      id: 'mailbox_1',
      organizationId: orgId,
      clientId: 'client_1',
      domainId: 'domain_1',
      status: 'ACTIVE',
      connectionStatus: 'CONNECTED',
      provisioningStatus: 'PROVISIONED',
    } as never);

    service = new SequenceEligibilityService(
      managedClients,
      domains,
      mailboxes,
      mailboxAssignments,
      clientAssignments,
      users,
      crmEligibility as unknown as CrmClientEligibilityService,
    );
  });

  function input(overrides: Partial<Parameters<SequenceEligibilityService['verify']>[0]> = {}) {
    return { organizationId: orgId, clientId: 'client_1', executiveId: 'exec_1', domainId: 'domain_1', mailboxId: 'mailbox_1', ...overrides };
  }

  it('passes with everything active, assigned and connected', async () => {
    const result = await service.verify(input());
    expect(result.managedClient.id).toBe('client_1');
    expect(result.domain?.id).toBe('domain_1');
    expect(result.mailbox?.id).toBe('mailbox_1');
    expect(result.mailboxAlreadyAssigned).toBe(false);
  });

  it('never writes to any repository, never records audit — pure validation', async () => {
    await service.verify(input());
    expect(managedClients.update).not.toHaveBeenCalled();
    expect(domains.update).not.toHaveBeenCalled();
    expect(mailboxes.update).not.toHaveBeenCalled();
  });

  it('rejects an inactive executive', async () => {
    users.findById.mockResolvedValue({ id: 'exec_1', organizationId: orgId, status: 'INACTIVE' } as never);
    await expect(service.verify(input())).rejects.toThrow(BadRequestException);
  });

  it('404s for an executive from another organization', async () => {
    users.findById.mockResolvedValue({ id: 'exec_1', organizationId: 'other_org', status: 'ACTIVE' } as never);
    await expect(service.verify(input())).rejects.toThrow(NotFoundException);
  });

  it('rejects an operationally inactive ManagedClient', async () => {
    managedClients.findById.mockResolvedValue({ id: 'client_1', organizationId: orgId, crmClientId: 7, status: 'INACTIVE' } as never);
    await expect(service.verify(input())).rejects.toThrow(BadRequestException);
  });

  it('propagates the CRM eligibility check as-is (e.g. 409 inactive-in-CRM)', async () => {
    const { ConflictException: CE } = await import('@nestjs/common');
    crmEligibility.getVerifiedActiveClient.mockRejectedValue(new CE('inactive'));
    await expect(service.verify(input())).rejects.toThrow(ConflictException);
  });

  it('rejects an executive not assigned to the client', async () => {
    clientAssignments.findByUser.mockResolvedValue([{ clientId: 'some_other_client' } as never]);
    await expect(service.verify(input())).rejects.toThrow(BadRequestException);
  });

  it('rejects a domain that does not belong to the given client', async () => {
    domains.findById.mockResolvedValue({ id: 'domain_1', organizationId: orgId, clientId: 'other_client', status: 'ACTIVE' } as never);
    await expect(service.verify(input())).rejects.toThrow(BadRequestException);
  });

  it('rejects an inactive domain', async () => {
    domains.findById.mockResolvedValue({ id: 'domain_1', organizationId: orgId, clientId: 'client_1', status: 'INACTIVE' } as never);
    await expect(service.verify(input())).rejects.toThrow(BadRequestException);
  });

  it('rejects a mailbox belonging to a different domain', async () => {
    mailboxes.findById.mockResolvedValue({
      id: 'mailbox_1', organizationId: orgId, clientId: 'client_1', domainId: 'other_domain',
      status: 'ACTIVE', connectionStatus: 'CONNECTED', provisioningStatus: 'PROVISIONED',
    } as never);
    await expect(service.verify(input())).rejects.toThrow(BadRequestException);
  });

  it('rejects a mailbox that is not connected/provisioned (409)', async () => {
    mailboxes.findById.mockResolvedValue({
      id: 'mailbox_1', organizationId: orgId, clientId: 'client_1', domainId: 'domain_1',
      status: 'ACTIVE', connectionStatus: 'CONNECTION_ERROR', provisioningStatus: 'PROVISIONED',
    } as never);
    await expect(service.verify(input())).rejects.toThrow(ConflictException);
  });

  it('works without domainId/mailboxId (both optional, e.g. for a bare client-eligibility check)', async () => {
    const result = await service.verify({ organizationId: orgId, clientId: 'client_1', executiveId: 'exec_1' });
    expect(result.domain).toBeNull();
    expect(result.mailbox).toBeNull();
    expect(domains.findById).not.toHaveBeenCalled();
    expect(mailboxes.findById).not.toHaveBeenCalled();
  });

  it('reports mailboxAlreadyAssigned correctly', async () => {
    mailboxAssignments.findByMailbox.mockResolvedValue([{ userId: 'exec_1' } as never]);
    const result = await service.verify(input());
    expect(result.mailboxAlreadyAssigned).toBe(true);
  });
});
