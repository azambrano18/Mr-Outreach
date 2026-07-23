export type MailboxAdminStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

/**
 * NOT_TESTED until a connection test runs (see MailboxesService.testConnection,
 * Phase 4). TESTING is modeled for a future async engine but is never
 * persisted today — the mock engine responds synchronously.
 */
export type MailboxConnectionStatus =
  | 'NOT_TESTED'
  | 'TESTING'
  | 'CONNECTED'
  | 'PARTIALLY_CONNECTED'
  | 'CONNECTION_ERROR'
  | 'ENGINE_UNAVAILABLE';

export type MailboxEncryption = 'SSL_TLS' | 'STARTTLS' | 'NONE';

/**
 * §12 — kept separate from `connectionStatus` on purpose: provisioning is
 * "has the simulated/real engine finished setting up this mailbox at all",
 * while `connectionStatus` (below, pre-existing) is "is IMAP/SMTP currently
 * reachable" — the two can diverge (e.g. PROVISIONED but later
 * CONNECTION_ERROR after a password rotation). "Estado operativo" from the
 * spec is intentionally NOT a third persisted field — it's derived from
 * these two plus `status` wherever a summary is built (see MailboxesService).
 */
export type MailboxProvisioningStatus =
  | 'NOT_PROVISIONED'
  | 'PROVISION_REQUESTED'
  | 'PROVISIONING'
  | 'PROVISIONED'
  | 'PROVISION_FAILED';

/** §10/§23 — sent verbatim inside MAILBOX_PROVISION_REQUESTED and read back by the scheduling simulation (§23's daily-limit/interval math). */
export interface MailboxSendingLimits {
  dailyLimit: number;
  minimumIntervalSeconds: number;
  maximumIntervalSeconds: number;
}

export interface MailboxProtocolConfig {
  host: string;
  port: number;
  encryption: MailboxEncryption;
  username: string;
  verifyCertificate: boolean;
  /**
   * Opaque, AES-256-GCM encrypted (see SecretEncryptionService). Never the
   * plaintext password, and never returned by any repository consumer
   * outside the persistence layer's own create/update path.
   */
  secretCiphertext: string;
}

export interface Mailbox {
  id: string;
  organizationId: string;
  /**
   * Both null while the mailbox is "Pendiente de clasificación" (not yet
   * linked into the Cliente → Dominio hierarchy) — an explicit, allowed
   * temporary state (see §6/§31 of the client-hierarchy pivot), never
   * silently defaulted to a fabricated client. `domainId` set implies
   * `clientId` set: a mailbox is never linked to a domain without also
   * being linked to that domain's client (enforced in MailboxesService).
   */
  clientId: string | null;
  domainId: string | null;
  name: string;
  email: string;
  fromName: string;
  replyTo: string | null;
  status: MailboxAdminStatus;
  connectionStatus: MailboxConnectionStatus;
  provisioningStatus: MailboxProvisioningStatus;
  timezone: string;
  sendingLimits: MailboxSendingLimits;
  /** Set once provisioning is requested; lets the UI find "the command behind this mailbox" without a separate lookup table. */
  lastProvisionCommandId: string | null;
  lastTestedAt: Date | null;
  lastTestedBy: string | null;
  lastTestMessage: string | null;
  imap: MailboxProtocolConfig;
  smtp: MailboxProtocolConfig;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateMailboxInput {
  organizationId: string;
  name: string;
  email: string;
  fromName: string;
  replyTo?: string | null;
  timezone?: string;
  sendingLimits?: MailboxSendingLimits;
  imap: MailboxProtocolConfig;
  smtp: MailboxProtocolConfig;
}

export interface UpdateMailboxInput {
  name?: string;
  email?: string;
  fromName?: string;
  replyTo?: string | null;
  status?: MailboxAdminStatus;
  connectionStatus?: MailboxConnectionStatus;
  provisioningStatus?: MailboxProvisioningStatus;
  timezone?: string;
  sendingLimits?: Partial<MailboxSendingLimits>;
  lastProvisionCommandId?: string | null;
  lastTestedAt?: Date | null;
  lastTestedBy?: string | null;
  lastTestMessage?: string | null;
  imap?: Partial<MailboxProtocolConfig>;
  smtp?: Partial<MailboxProtocolConfig>;
  clientId?: string | null;
  domainId?: string | null;
}
