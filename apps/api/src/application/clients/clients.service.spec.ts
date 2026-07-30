import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { ManagedClient } from '../../domain/client/managed-client.entity';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { UserRepository } from '../../domain/user/user.repository';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ClientEligibilityService } from './client-eligibility.service';
import { ClientsService, ServerClientPayload } from './clients.service';

describe('ClientsService', () => {
  let clients: jest.Mocked<ManagedClientRepository>;
  let assignments: jest.Mocked<ClientExecutiveAssignmentRepository>;
  let domains: jest.Mocked<Pick<DomainRepository, 'findByClient'>>;
  let mailboxes: jest.Mocked<Pick<MailboxRepository, 'findAll'>>;
  let sequences: jest.Mocked<Pick<SequenceRepository, 'findByClient'>>;
  let conversations: jest.Mocked<Pick<ConversationRepository, 'findAll'>>;
  let users: jest.Mocked<Pick<UserRepository, 'findById'>>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let eligibility: jest.Mocked<Pick<ClientEligibilityService, 'assertEligible'>>;
  let service: ClientsService;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';

  const buildServerPayload = (overrides: Partial<ServerClientPayload> = {}): ServerClientPayload => ({
    serverClientId: 'srv_1001',
    name: 'Acme Inc',
    ...overrides,
  });

  const buildManagedClient = (overrides: Partial<ManagedClient> = {}): ManagedClient => ({
    id: 'client_1',
    organizationId: orgId,
    source: 'SERVER',
    serverClientId: 'srv_1001',
    name: 'Acme Inc',
    legalName: null,
    internalCode: null,
    industry: 'Tecnología',
    status: 'ACTIVE',
    logoUrl: null,
    startDate: null,
    supervisorUserId: null,
    notes: null,
    clientRutSnapshot: null,
    externalStatusSnapshot: null,
    externalStatusCheckedAt: null,
    createdBy: 'admin_1',
    updatedBy: 'admin_1',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    clients = {
      findById: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findByServerClientId: jest.fn(),
    };
    assignments = {
      findByClient: jest.fn().mockResolvedValue([]),
      findByUser: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      remove: jest.fn(),
    } as unknown as jest.Mocked<ClientExecutiveAssignmentRepository>;
    domains = { findByClient: jest.fn().mockResolvedValue([]) };
    mailboxes = { findAll: jest.fn().mockResolvedValue([]) };
    sequences = { findByClient: jest.fn().mockResolvedValue([]) };
    conversations = { findAll: jest.fn().mockResolvedValue([]) };
    users = { findById: jest.fn() };
    auditLogs = { record: jest.fn(), findAll: jest.fn() } as unknown as jest.Mocked<AuditLogRepository>;
    eligibility = { assertEligible: jest.fn() };

    service = new ClientsService(
      clients,
      assignments,
      domains as unknown as DomainRepository,
      mailboxes as unknown as MailboxRepository,
      sequences as unknown as SequenceRepository,
      conversations as unknown as ConversationRepository,
      users as unknown as UserRepository,
      auditLogs,
      eligibility as unknown as ClientEligibilityService,
    );
  });

  describe('upsertFromServerPayload', () => {
    it('creates a new ManagedClient from the server payload on first redemption', async () => {
      clients.findByServerClientId.mockResolvedValue(null);
      clients.create.mockResolvedValue(buildManagedClient());

      await service.upsertFromServerPayload(orgId, buildServerPayload(), 'admin_1', {
        legalName: 'Acme Legal SpA',
        notes: 'VIP',
      });

      expect(clients.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          source: 'SERVER',
          serverClientId: 'srv_1001',
          name: 'Acme Inc',
          legalName: 'Acme Legal SpA',
          notes: 'VIP',
          createdBy: 'admin_1',
        }),
        undefined,
      );
    });

    it('is idempotent: a repeat redemption for the same serverClientId updates instead of duplicating', async () => {
      const existing = buildManagedClient();
      clients.findByServerClientId.mockResolvedValue(existing);
      clients.update.mockResolvedValue({ ...existing, name: 'Acme Incorporated' });

      await service.upsertFromServerPayload(orgId, buildServerPayload({ name: 'Acme Incorporated' }), 'admin_1');

      expect(clients.create).not.toHaveBeenCalled();
      expect(clients.update).toHaveBeenCalledWith(
        existing.id,
        expect.objectContaining({ name: 'Acme Incorporated', updatedBy: 'admin_1' }),
        undefined,
      );
    });

    it('never overwrites operational fields on update — only the name snapshot', async () => {
      const existing = buildManagedClient({ legalName: 'Acme Legal SpA', notes: 'VIP', internalCode: 'INT-1' });
      clients.findByServerClientId.mockResolvedValue(existing);
      clients.update.mockResolvedValue(existing);

      await service.upsertFromServerPayload(orgId, buildServerPayload(), 'admin_1');

      const updateCall = clients.update.mock.calls[0][1];
      expect(updateCall).not.toHaveProperty('legalName');
      expect(updateCall).not.toHaveProperty('notes');
      expect(updateCall).not.toHaveProperty('internalCode');
    });

    it('preserves createdBy/createdAt on update (update() only patches the fields given)', async () => {
      const existing = buildManagedClient();
      clients.findByServerClientId.mockResolvedValue(existing);
      clients.update.mockResolvedValue(existing);

      await service.upsertFromServerPayload(orgId, buildServerPayload(), 'someone_else');

      const updateCall = clients.update.mock.calls[0][1];
      expect(updateCall).not.toHaveProperty('createdBy');
      expect(updateCall).not.toHaveProperty('createdAt');
    });
  });

  describe('assertClientEligible', () => {
    it('does not throw when the client is eligible', async () => {
      const managed = buildManagedClient();
      clients.findById.mockResolvedValue(managed);
      eligibility.assertEligible.mockReturnValue(undefined);

      await expect(service.assertClientEligible(orgId, managed.id)).resolves.toBeUndefined();
      expect(eligibility.assertEligible).toHaveBeenCalledWith(managed);
    });

    it('propagates the eligibility check as-is when the client is inactive', async () => {
      const managed = buildManagedClient({ status: 'INACTIVE' });
      clients.findById.mockResolvedValue(managed);
      eligibility.assertEligible.mockImplementation(() => {
        throw new ConflictException('inactivo');
      });

      await expect(service.assertClientEligible(orgId, managed.id)).rejects.toThrow(ConflictException);
    });

    it('404s (never leaks) for a ManagedClient belonging to another organization', async () => {
      const managed = buildManagedClient({ organizationId: otherOrgId });
      clients.findById.mockResolvedValue(managed);

      await expect(service.assertClientEligible(orgId, managed.id)).rejects.toThrow(NotFoundException);
      expect(eligibility.assertEligible).not.toHaveBeenCalled();
    });
  });
});
