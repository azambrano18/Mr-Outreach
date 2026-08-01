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

/**
 * Fase 2.1 — which system is authoritative for this account's credentials.
 * LEGACY_LOCAL: pre-Fase-2.1 manual IMAP/SMTP flow, kept for coexistence.
 * SERVER_TOKEN: linked via a motor-issued token; Mr Outreach never holds
 * its credentials.
 */
export type MailboxLinkSource = 'LEGACY_LOCAL' | 'SERVER_TOKEN';

/** Fase 2.1 — orthogonal to MailboxProvisioningStatus/MailboxConnectionStatus, which describe the LEGACY_LOCAL flow only. LEGACY marks a not-yet-migrated pre-Fase-2.1 account. */
export type MailboxLinkStatus = 'LINK_PENDING' | 'ACTIVE' | 'UNLINK_REQUESTED' | 'REVOKED' | 'LINK_ERROR' | 'LEGACY';

/** Fase 2.1 — mirrors MailboxTechnicalStatus in domain/mailbox-motor/mailbox-motor.types.ts exactly. */
export type MailboxServerTechnicalStatus = 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'DISABLED' | 'UNKNOWN';

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
  /**
   * Fase 2.1 — null for a SERVER_TOKEN mailbox: Mr Outreach never holds its
   * IMAP credentials. Always populated for LEGACY_LOCAL. Callers that only
   * make sense for the legacy manual flow (test connection, legacy
   * provisioning) must guard on `linkSource`/nullness before use.
   */
  imap: MailboxProtocolConfig | null;
  /** Fase 2.1 — same nullability rule as `imap`, see above. */
  smtp: MailboxProtocolConfig | null;
  linkSource: MailboxLinkSource;
  linkStatus: MailboxLinkStatus;
  serverMailboxId: string | null;
  serverDomainId: string | null;
  serverClientId: string | null;
  serverRedemptionId: string | null;
  tokenFingerprint: string | null;
  emailSnapshot: string | null;
  domainSnapshot: string | null;
  clientNameSnapshot: string | null;
  serverStatusSnapshot: MailboxServerTechnicalStatus | null;
  serverCanSendSnapshot: boolean | null;
  serverStatusCheckedAt: Date | null;
  linkedAt: Date | null;
  linkedBy: string | null;
  unlinkRequestedAt: Date | null;
  unlinkRequestedBy: string | null;
  unlinkReason: string | null;
  revokedAt: Date | null;
  revocationId: string | null;
  lastLinkCommandId: string | null;
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

/** Fase 2.1 — the counterpart of CreateMailboxInput for a SERVER_TOKEN mailbox: never takes imap/smtp, always takes the motor-issued identifiers/snapshots instead. */
export interface CreateLinkedMailboxInput {
  organizationId: string;
  clientId: string;
  domainId: string;
  name: string;
  email: string;
  fromName: string;
  serverMailboxId: string;
  serverDomainId: string;
  serverClientId: string;
  serverRedemptionId: string;
  tokenFingerprint: string;
  emailSnapshot: string;
  domainSnapshot: string;
  clientNameSnapshot: string;
  serverStatusSnapshot: MailboxServerTechnicalStatus;
  serverCanSendSnapshot: boolean;
  serverStatusCheckedAt: Date;
  linkedAt: Date;
  linkedBy: string;
  lastLinkCommandId: string;
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
  // Fase 2.1 — link lifecycle fields, written by the linking/reassignment/
  // unlink use cases (never by the legacy CreateMailboxInput/update flow).
  linkStatus?: MailboxLinkStatus;
  serverStatusSnapshot?: MailboxServerTechnicalStatus | null;
  serverCanSendSnapshot?: boolean | null;
  serverStatusCheckedAt?: Date | null;
  unlinkRequestedAt?: Date | null;
  unlinkRequestedBy?: string | null;
  unlinkReason?: string | null;
  revokedAt?: Date | null;
  revocationId?: string | null;
  lastLinkCommandId?: string | null;
  /** Set once, on deletion — see DeleteMailboxUseCase. Every read path already filters `deletedAt: null`. */
  deletedAt?: Date;
}
