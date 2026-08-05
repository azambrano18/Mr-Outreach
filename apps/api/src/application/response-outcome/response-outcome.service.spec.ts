import { ConflictException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { ConversationNoteRepository } from '../../domain/conversation/conversation-note.repository';
import { Conversation } from '../../domain/conversation/conversation.entity';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { SequenceContact } from '../../domain/sequence-contact/sequence-contact.entity';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { Sequence } from '../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { IntegrationService } from '../integration/integration.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { ResponseOutcomeService } from './response-outcome.service';

/**
 * Focused unit coverage for the "Deriva"/REFERRED path's dependency on
 * Sequence.clientId — the bug fixed by the sequence-client-id migration +
 * PrismaSequenceRepository fix. Every other outcome (INTERESTED/
 * NOT_INTERESTED/DO_NOT_CONTACT) and the rest of refer()'s own behavior are
 * already covered end-to-end by response-outcome.e2e-spec.ts; this file
 * exists only to pin down, at the unit level, the specific precondition
 * this fix touches — without re-deriving the service's full test double
 * setup for scenarios that already have e2e coverage.
 */
describe('ResponseOutcomeService.refer — Sequence.clientId precondition', () => {
  const organizationId = 'org_1';
  const actorId = 'actor_1';
  const conversationId = 'conv_1';

  const conversation: Conversation = {
    id: conversationId,
    organizationId,
    mailboxId: 'mailbox_1',
    sequenceContactId: 'sc_1',
    contactId: 'contact_1',
    contactEmail: 'contacto@example.com',
  } as unknown as Conversation;

  const sequenceContact: SequenceContact = {
    id: 'sc_1',
    organizationId,
    sequenceId: 'sequence_1',
    contactId: 'contact_1',
    companyId: 'company_1',
    clientId: 'client_1',
    assignedExecutiveId: 'exec_1',
  } as unknown as SequenceContact;

  const contact = {
    id: 'contact_1',
    organizationId,
    clientId: 'client_1',
    companyId: 'company_1',
    email: 'contacto@example.com',
  };

  function buildService(sequence: Sequence | null) {
    const conversationRepo: jest.Mocked<Pick<ConversationRepository, 'findById' | 'update'>> = {
      findById: jest.fn().mockResolvedValue(conversation),
      update: jest.fn().mockResolvedValue(conversation),
    };
    const sequenceContacts: jest.Mocked<
      Pick<SequenceContactRepository, 'findById' | 'update' | 'findByContactAndSequence'>
    > = {
      findById: jest.fn().mockResolvedValue(sequenceContact),
      update: jest.fn().mockResolvedValue({ ...sequenceContact, status: 'REMOVED' }),
      findByContactAndSequence: jest.fn().mockResolvedValue(null),
    };
    const contacts: jest.Mocked<Pick<ContactRepository, 'findById' | 'findByEmail' | 'create'>> = {
      findById: jest.fn().mockResolvedValue(contact),
      findByEmail: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ ...contact, id: 'contact_new', email: 'nuevo@example.com' }),
    };
    const sequences: jest.Mocked<Pick<SequenceRepository, 'findById'>> = {
      findById: jest.fn().mockResolvedValue(sequence),
    };
    const mailboxes: jest.Mocked<Pick<MailboxRepository, 'findById'>> = {
      findById: jest.fn().mockResolvedValue(null),
    };
    const auditLogs: jest.Mocked<Pick<AuditLogRepository, 'record'>> = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const notes: jest.Mocked<Pick<ConversationNoteRepository, 'create'>> = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    const integration: jest.Mocked<Pick<IntegrationService, 'submit' | 'advance'>> = {
      submit: jest.fn().mockResolvedValue({ command: { commandId: 'cmd_1' }, duplicate: false }),
      advance: jest.fn().mockResolvedValue(undefined),
    };
    const scheduling: jest.Mocked<Pick<SchedulingService, 'cancelFutureJobsForContact' | 'enrollAcceptedContacts' | 'sendFirstStepNow'>> = {
      cancelFutureJobsForContact: jest.fn().mockResolvedValue(0),
      enrollAcceptedContacts: jest.fn().mockResolvedValue({ enrolled: [{ id: 'sc_new' }], firstStep: { id: 'step_1' } }),
      sendFirstStepNow: jest.fn().mockResolvedValue(undefined),
    };

    const service = new ResponseOutcomeService(
      conversationRepo as unknown as ConversationRepository,
      sequenceContacts as unknown as SequenceContactRepository,
      contacts as unknown as ContactRepository,
      sequences as unknown as SequenceRepository,
      mailboxes as unknown as MailboxRepository,
      auditLogs as unknown as AuditLogRepository,
      notes as unknown as ConversationNoteRepository,
      integration as unknown as IntegrationService,
      scheduling as unknown as SchedulingService,
    );

    return { service, scheduling, sequences };
  }

  const referInput = {
    newContactEmail: 'nuevo@example.com',
    sendFirstStepImmediately: false,
  };

  it('throws a clear, Spanish domain error — not a generic 500 — when the sequence has no clientId, and never reaches enrollAcceptedContacts', async () => {
    const { service, scheduling } = buildService({ id: 'sequence_1', clientId: null } as unknown as Sequence);

    await expect(service.refer(organizationId, conversationId, actorId, referInput)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.refer(organizationId, conversationId, actorId, referInput)).rejects.toThrow(
      'No se puede registrar la derivación porque la secuencia no tiene un cliente asociado.',
    );
    expect(scheduling.enrollAcceptedContacts).not.toHaveBeenCalled();
  });

  it('proceeds to enrollAcceptedContacts once the sequence has a real, persisted clientId', async () => {
    const { service, scheduling, sequences } = buildService({
      id: 'sequence_1',
      clientId: 'client_1',
    } as unknown as Sequence);

    const result = await service.refer(organizationId, conversationId, actorId, referInput);

    expect(sequences.findById).toHaveBeenCalledWith('sequence_1');
    expect(scheduling.enrollAcceptedContacts).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ clientId: 'client_1' }),
      expect.any(Array),
    );
    expect(result.newSequenceContact).toEqual({ id: 'sc_new' });
  });
});
