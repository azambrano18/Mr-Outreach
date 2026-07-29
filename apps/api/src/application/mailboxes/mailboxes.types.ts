import {
  MailboxAdminStatus,
  MailboxConnectionStatus,
  MailboxEncryption,
  MailboxLinkSource,
  MailboxLinkStatus,
  MailboxProvisioningStatus,
  MailboxSendingLimits,
  MailboxServerTechnicalStatus,
} from '../../domain/mailbox/mailbox.entity';

/** §12 — computed, never persisted (see Mailbox entity's doc comment on provisioningStatus). */
export type MailboxOperationalStatus = 'DRAFT' | 'READY' | 'PAUSED' | 'SUSPENDED' | 'ERROR' | 'ARCHIVED';

export interface ProtocolConfigSummary {
  host: string;
  port: number;
  encryption: MailboxEncryption;
  username: string;
  verifyCertificate: boolean;
  /** Never the secret itself — see README > "Cifrado de credenciales". */
  credentialsConfigured: true;
}

export interface MailboxSummary {
  id: string;
  organizationId: string;
  clientId: string | null;
  domainId: string | null;
  /** Read-only display name of the client this mailbox belongs to — resolved from the snapshot (SERVER_TOKEN) or the live ManagedClient (legacy); never editable from here. */
  clientName: string | null;
  /** Read-only display name of the domain this mailbox belongs to — same resolution rule as clientName. */
  domainName: string | null;
  name: string;
  email: string;
  fromName: string;
  replyTo: string | null;
  status: MailboxAdminStatus;
  connectionStatus: MailboxConnectionStatus;
  provisioningStatus: MailboxProvisioningStatus;
  operationalStatus: MailboxOperationalStatus;
  timezone: string;
  sendingLimits: MailboxSendingLimits;
  lastProvisionCommandId: string | null;
  lastTestedAt: Date | null;
  lastTestMessage: string | null;
  /** Fase 2.1 — null for a SERVER_TOKEN mailbox. */
  imap: ProtocolConfigSummary | null;
  /** Fase 2.1 — null for a SERVER_TOKEN mailbox. */
  smtp: ProtocolConfigSummary | null;
  linkSource: MailboxLinkSource;
  linkStatus: MailboxLinkStatus;
  serverMailboxId: string | null;
  serverStatusSnapshot: MailboxServerTechnicalStatus | null;
  serverCanSendSnapshot: boolean | null;
  serverStatusCheckedAt: Date | null;
  linkedAt: Date | null;
  linkedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * §12.1 — one denormalized row per mailbox for the admin listing/filter
 * screen: client/domain names and primary-executive name resolved
 * server-side (one pass over the org's mailboxes/domains/clients/
 * assignments) so the frontend never has to orchestrate N+1 fetches.
 */
export interface MailboxAdminOverviewItem {
  id: string;
  clientId: string | null;
  clientName: string | null;
  domainId: string | null;
  domainName: string | null;
  name: string;
  email: string;
  primaryExecutive: { id: string; name: string } | null;
  secondaryExecutiveCount: number;
  linkSource: MailboxLinkSource;
  linkStatus: MailboxLinkStatus;
  status: MailboxAdminStatus;
  serverStatusSnapshot: MailboxServerTechnicalStatus | null;
  serverCanSendSnapshot: boolean | null;
  serverStatusCheckedAt: Date | null;
}

export interface ProtocolConfigInput {
  host: string;
  port: number;
  encryption: MailboxEncryption;
  username: string;
  password: string;
  verifyCertificate: boolean;
}

export interface CreateMailboxPayload {
  name: string;
  email: string;
  fromName: string;
  replyTo?: string;
  imap: ProtocolConfigInput;
  smtp: ProtocolConfigInput;
}

export interface UpdateProtocolConfigPayload {
  host?: string;
  port?: number;
  encryption?: MailboxEncryption;
  username?: string;
  /** Omitted -> keep the existing encrypted secret unchanged. */
  password?: string;
  verifyCertificate?: boolean;
}

export interface UpdateMailboxPayload {
  name?: string;
  email?: string;
  fromName?: string;
  replyTo?: string;
  imap?: UpdateProtocolConfigPayload;
  smtp?: UpdateProtocolConfigPayload;
}

export interface MailboxTestResultSummary {
  mailboxId: string;
  status: Exclude<MailboxConnectionStatus, 'NOT_TESTED' | 'TESTING'>;
  imap: { success: boolean; errorCode?: string };
  smtp: { success: boolean; errorCode?: string };
  message: string;
  testedAt: Date;
}

export interface MailboxConnectionTestSummary {
  id: string;
  status: Exclude<MailboxConnectionStatus, 'NOT_TESTED' | 'TESTING'>;
  imapSuccess: boolean;
  imapErrorCode: string | null;
  smtpSuccess: boolean;
  smtpErrorCode: string | null;
  message: string;
  technicalMessage: string;
  executedBy: string;
  createdAt: Date;
}

export interface AssigneeSummary {
  id: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  role: 'PRIMARY' | 'SECONDARY';
}

export interface SetMailboxAssigneesPayload {
  primaryUserId: string | null;
  secondaryUserIds: string[];
}

/** What an executive sees for a mailbox assigned to them via GET /me/mailboxes — no host/port/credential detail, they never configure the account directly. */
export interface AssignedMailboxSummary {
  id: string;
  name: string;
  email: string;
  fromName: string;
  replyTo: string | null;
  status: MailboxAdminStatus;
  connectionStatus: MailboxConnectionStatus;
}

export interface InboxParticipantSummary {
  name: string | null;
  email: string;
}

export interface InboxThreadSummary {
  id: string;
  subject: string;
  participants: InboxParticipantSummary[];
  lastMessageAt: string;
  lastMessageSnippet: string;
  unreadCount: number;
  messageCount: number;
}

export interface InboxMessageSummary {
  id: string;
  threadId: string;
  from: InboxParticipantSummary;
  to: InboxParticipantSummary[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  direction: 'INBOUND' | 'OUTBOUND';
  isUnread: boolean;
  receivedAt: string;
}

export type MailboxInboxStatus = 'OK' | 'CONNECTION_ERROR' | 'ENGINE_UNAVAILABLE';

export interface MailboxInboxSummary {
  status: MailboxInboxStatus;
  threads: InboxThreadSummary[];
}

export interface MailboxThreadDetail {
  status: MailboxInboxStatus | 'NOT_FOUND';
  messages: InboxMessageSummary[];
}

export interface MailboxThreadReadStateResult {
  status: MailboxInboxStatus;
}
