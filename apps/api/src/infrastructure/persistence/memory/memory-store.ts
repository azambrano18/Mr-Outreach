import { Injectable } from '@nestjs/common';
import { AuditLogEntry } from '../../../domain/audit/audit-log.entity';
import { ClientExecutiveAssignment } from '../../../domain/client/client-executive-assignment.entity';
import { ManagedClient } from '../../../domain/client/managed-client.entity';
import { Company } from '../../../domain/company/company.entity';
import { Contact } from '../../../domain/contact/contact.entity';
import { ConversationMessage } from '../../../domain/conversation/conversation-message.entity';
import { ConversationNote } from '../../../domain/conversation/conversation-note.entity';
import { ConversationTag } from '../../../domain/conversation/conversation-tag.entity';
import { Conversation } from '../../../domain/conversation/conversation.entity';
import { Domain } from '../../../domain/domain-entity/domain.entity';
import { IntegrationCommand } from '../../../domain/integration/integration-command.entity';
import { IntegrationEvent } from '../../../domain/integration/integration-event.entity';
import { MailboxAssignment } from '../../../domain/mailbox-assignment/mailbox-assignment.entity';
import { MailboxConnectionTest } from '../../../domain/mailbox/mailbox-connection-test.entity';
import { Mailbox } from '../../../domain/mailbox/mailbox.entity';
import { Organization } from '../../../domain/organization/organization.entity';
import { Permission } from '../../../domain/permission/permission.entity';
import { Role } from '../../../domain/role/role.entity';
import { ScheduledEmail } from '../../../domain/scheduled-email/scheduled-email.entity';
import { SequenceContact } from '../../../domain/sequence-contact/sequence-contact.entity';
import { SequenceImport } from '../../../domain/sequence-import/sequence-import.entity';
import { SequenceImportRow } from '../../../domain/sequence-import-row/sequence-import-row.entity';
import { SequenceStepVersion } from '../../../domain/sequence/sequence-step-version.entity';
import { SequenceStep } from '../../../domain/sequence/sequence-step.entity';
import { Sequence } from '../../../domain/sequence/sequence.entity';
import { SignatureVersion } from '../../../domain/signature/signature-version.entity';
import { Signature } from '../../../domain/signature/signature.entity';
import { Template } from '../../../domain/template/template.entity';
import { User } from '../../../domain/user/user.entity';
import { Variable } from '../../../domain/variable/variable.entity';

/**
 * The single shared piece of process memory backing every InMemory*
 * repository. One instance per running API process — data does not
 * survive a restart (documented limitation, see README).
 */
@Injectable()
export class MemoryStore {
  readonly organizations = new Map<string, Organization>();
  readonly users = new Map<string, User>();
  readonly roles = new Map<string, Role>();
  readonly permissions = new Map<string, Permission>();
  /** userId -> Set<roleId> */
  readonly userRoles = new Map<string, Set<string>>();
  /** roleId -> Set<permissionKey> */
  readonly rolePermissions = new Map<string, Set<string>>();
  readonly auditLogs: AuditLogEntry[] = [];
  readonly mailboxes = new Map<string, Mailbox>();
  readonly mailboxConnectionTests: MailboxConnectionTest[] = [];
  readonly mailboxAssignments: MailboxAssignment[] = [];
  readonly templates = new Map<string, Template>();
  readonly variables = new Map<string, Variable>();
  readonly signatures = new Map<string, Signature>();
  readonly signatureVersions: SignatureVersion[] = [];
  readonly sequences = new Map<string, Sequence>();
  readonly sequenceSteps = new Map<string, SequenceStep>();
  readonly sequenceStepVersions: SequenceStepVersion[] = [];
  readonly managedClients = new Map<string, ManagedClient>();
  readonly clientExecutiveAssignments: ClientExecutiveAssignment[] = [];
  readonly domains = new Map<string, Domain>();
  readonly conversations = new Map<string, Conversation>();
  readonly conversationMessages: ConversationMessage[] = [];
  readonly conversationTags = new Map<string, ConversationTag>();
  readonly conversationNotes: ConversationNote[] = [];
  readonly conversationTagAssignments: Array<{
    conversationId: string;
    tagId: string;
    appliedBy: string;
    appliedAt: Date;
  }> = [];
  readonly integrationCommands = new Map<string, IntegrationCommand>();
  readonly integrationEvents = new Map<string, IntegrationEvent>();
  readonly companies = new Map<string, Company>();
  readonly contacts = new Map<string, Contact>();
  readonly sequenceImports = new Map<string, SequenceImport>();
  readonly sequenceImportRows = new Map<string, SequenceImportRow>();
  readonly sequenceContacts = new Map<string, SequenceContact>();
  readonly scheduledEmails = new Map<string, ScheduledEmail>();

  /** Used by tests to start each case from a clean slate. */
  reset(): void {
    this.organizations.clear();
    this.users.clear();
    this.roles.clear();
    this.permissions.clear();
    this.userRoles.clear();
    this.rolePermissions.clear();
    this.auditLogs.length = 0;
    this.mailboxes.clear();
    this.mailboxConnectionTests.length = 0;
    this.mailboxAssignments.length = 0;
    this.templates.clear();
    this.variables.clear();
    this.signatures.clear();
    this.signatureVersions.length = 0;
    this.sequences.clear();
    this.sequenceSteps.clear();
    this.sequenceStepVersions.length = 0;
    this.managedClients.clear();
    this.clientExecutiveAssignments.length = 0;
    this.domains.clear();
    this.conversations.clear();
    this.conversationMessages.length = 0;
    this.conversationTags.clear();
    this.conversationNotes.length = 0;
    this.conversationTagAssignments.length = 0;
    this.integrationCommands.clear();
    this.integrationEvents.clear();
    this.companies.clear();
    this.contacts.clear();
    this.sequenceImports.clear();
    this.sequenceImportRows.clear();
    this.sequenceContacts.clear();
    this.scheduledEmails.clear();
  }
}
