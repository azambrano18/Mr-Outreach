export interface LivenessResponse {
  status: 'ok';
  service: 'api';
}

export interface ReadinessResponse {
  status: 'ok' | 'error';
  mode: 'development' | 'integrated';
  persistence: { driver: string; status: string };
  engine: { driver: string; status: string };
}

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  permissions: string[];
  mustChangePassword: boolean;
}

export interface LoginResult {
  accessToken: string;
  user: AuthenticatedUser;
}

export interface UserSummary {
  id: string;
  organizationId: string;
  /** Derived (`${firstName} ${lastName}`) — never persisted as its own column. */
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  roleId: string;
  roleName: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Returned once, only in the response of the call that generated the password — never persisted client-side beyond component state. */
export interface CreateUserResult extends UserSummary {
  temporaryPassword: string;
  /** True when this call restored a previously soft-deleted user (same email, same organization) instead of creating a new one. */
  restored: boolean;
}

export interface ResetPasswordResult {
  email: string;
  temporaryPassword: string;
}

/** Preview shown in the "Eliminar usuario" confirmation modal — see apps/api's UsersService.getDeletionImpact, which is the only place these numbers are actually computed and re-checked. */
export interface DeletionImpact {
  roleName: string;
  isProtectedSystemAccount: boolean;
  isSelf: boolean;
  /** ACTIVE -> INACTIVE -> DELETED is mandatory — true means the user must be deactivated first. */
  mustDeactivateFirst: boolean;
  isLastActiveAdmin: boolean;
  primaryMailboxCount: number;
  secondaryMailboxCount: number;
  activeExecutionCount: number;
  canDelete: boolean;
}

export interface RoleSummary {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserPayload {
  firstName: string;
  lastName: string;
  email: string;
  roleId: string;
}

export interface UpdateUserPayload {
  firstName?: string;
  lastName?: string;
  email?: string;
  roleId?: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export type MailboxAdminStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export type MailboxConnectionStatus =
  | 'NOT_TESTED'
  | 'TESTING'
  | 'CONNECTED'
  | 'PARTIALLY_CONNECTED'
  | 'CONNECTION_ERROR'
  | 'ENGINE_UNAVAILABLE';

export type MailboxEncryption = 'SSL_TLS' | 'STARTTLS' | 'NONE';

/** §12 of the mail-engine simulation phase — separate from `connectionStatus` (IMAP/SMTP reachability). */
export type MailboxProvisioningStatus =
  | 'NOT_PROVISIONED'
  | 'PROVISION_REQUESTED'
  | 'PROVISIONING'
  | 'PROVISIONED'
  | 'PROVISION_FAILED';

/** Computed, never persisted — derived from status + connectionStatus + provisioningStatus. */
export type MailboxOperationalStatus = 'DRAFT' | 'READY' | 'PAUSED' | 'SUSPENDED' | 'ERROR' | 'ARCHIVED';

/** Fase 2.1 — which system is authoritative for this account's credentials. */
export type MailboxLinkSource = 'LEGACY_LOCAL' | 'SERVER_TOKEN';

/** Fase 2.1 — the token-link lifecycle, orthogonal to connectionStatus/provisioningStatus (LEGACY_LOCAL-only). */
export type MailboxLinkStatus = 'LINK_PENDING' | 'ACTIVE' | 'UNLINK_REQUESTED' | 'REVOKED' | 'LINK_ERROR' | 'LEGACY';

/** Fase 2.1 — mirrors the motor's own MailboxTechnicalStatus vocabulary. */
export type MailboxServerTechnicalStatus = 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'DISABLED' | 'UNKNOWN';

export interface MailboxSendingLimits {
  dailyLimit: number;
  minimumIntervalSeconds: number;
  maximumIntervalSeconds: number;
}

export interface ProtocolConfigSummary {
  host: string;
  port: number;
  encryption: MailboxEncryption;
  username: string;
  verifyCertificate: boolean;
  credentialsConfigured: true;
}

export interface MailboxSummary {
  id: string;
  organizationId: string;
  clientId: string | null;
  domainId: string | null;
  /** Read-only display name of the client this mailbox belongs to — never editable from here. */
  clientName: string | null;
  /** Read-only display name of the domain this mailbox belongs to — never editable from here. */
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
  lastTestedAt: string | null;
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
  serverStatusCheckedAt: string | null;
  linkedAt: string | null;
  linkedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** §12.1 — denormalized row for the admin mailbox listing/filter screen. */
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
  serverStatusCheckedAt: string | null;
}

export interface ProtocolConfigPayload {
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
  imap: ProtocolConfigPayload;
  smtp: ProtocolConfigPayload;
}

export interface UpdateProtocolConfigPayload {
  host?: string;
  port?: number;
  encryption?: MailboxEncryption;
  username?: string;
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

export type MailboxTestOutcomeStatus = Exclude<MailboxConnectionStatus, 'NOT_TESTED' | 'TESTING'>;

export interface MailboxTestResultSummary {
  mailboxId: string;
  status: MailboxTestOutcomeStatus;
  imap: { success: boolean; errorCode?: string };
  smtp: { success: boolean; errorCode?: string };
  message: string;
  testedAt: string;
}

export interface MailboxConnectionTestSummary {
  id: string;
  status: MailboxTestOutcomeStatus;
  imapSuccess: boolean;
  imapErrorCode: string | null;
  smtpSuccess: boolean;
  smtpErrorCode: string | null;
  message: string;
  technicalMessage: string;
  executedBy: string;
  createdAt: string;
}

export type MailboxAssignmentRole = 'PRIMARY' | 'SECONDARY';

export interface AssigneeSummary {
  id: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  role: MailboxAssignmentRole;
}

export interface SetMailboxAssigneesPayload {
  primaryUserId: string | null;
  secondaryUserIds: string[];
}

export interface AssignedMailboxSummary {
  id: string;
  name: string;
  email: string;
  fromName: string;
  replyTo: string | null;
  status: MailboxAdminStatus;
  connectionStatus: MailboxConnectionStatus;
  lastTestedAt: string | null;
  lastTestMessage: string | null;
  /** Read-only — resolved from the mailbox's SERVER_TOKEN snapshot or live ManagedClient lookup, same rule as MailboxSummary.clientName. */
  clientName: string | null;
  domainName: string | null;
}

export type TemplateStatus = 'ACTIVE' | 'ARCHIVED';

export interface TemplateSummary {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  body: string;
  status: TemplateStatus;
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplatePayload {
  name: string;
  subject: string;
  body: string;
}

export interface UpdateTemplatePayload {
  name?: string;
  subject?: string;
  body?: string;
}

export type VariableStatus = 'ACTIVE' | 'ARCHIVED';
export type VariableSource = 'CONTACT' | 'SENDER' | 'CUSTOM';

export interface VariableSummary {
  id: string;
  organizationId: string;
  key: string;
  label: string;
  description: string | null;
  source: VariableSource;
  status: VariableStatus;
  createdAt: string;
  updatedAt: string;
}

/** Simplified per spec §5.1 — an admin-created variable is always a bare, {source:'CUSTOM'} entry with just a key and a label. */
export interface CreateVariablePayload {
  key: string;
  label: string;
}

export interface UpdateVariablePayload {
  key?: string;
  label?: string;
}

export type SignatureStatus = 'ACTIVE' | 'ARCHIVED';

export interface SignatureVersionSummary {
  id: string;
  versionNumber: number;
  htmlContent: string;
  plainTextContent: string;
  variables: string[];
  createdAt: string;
  createdBy: string;
  isActive: boolean;
}

export interface SignatureSummary {
  id: string;
  mailboxId: string;
  status: SignatureStatus;
  activeVersion: SignatureVersionSummary | null;
  versions: SignatureVersionSummary[];
}

export interface CreateSignaturePayload {
  htmlContent: string;
  plainTextContent?: string;
}

export interface SignaturePreview {
  htmlContent: string;
  renderedHtml: string;
  plainTextContent: string;
  renderedPlainText: string;
  variables: string[];
  usesRealSenderData: boolean;
}

export interface SendTestSignaturePayload {
  to: string;
}

export interface SendTestSignatureResult {
  accepted: boolean;
  message: string;
}

export interface UploadImageResponse {
  url: string;
}

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type SequenceStatus = 'DRAFT' | 'PAUSED' | 'ARCHIVED';

/** FLEXIBLE = the original free-form step editing API; FIXED_3 = the new wizard's Enviados_1/2/3, never addable/removable/renameable/reorderable. */
export type SequenceStepPolicy = 'FLEXIBLE' | 'FIXED_3';

/** Engine-reported lifecycle of the last "Publicar secuencia" — null until published at least once. */
export type SequencePublishStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface SequenceSchedule {
  days: string[];
  windows: Array<{ start: string; end: string }>;
}

export interface SequencePolicies {
  stopOnReply: boolean;
  stopOnHardBounce: boolean;
  stopOnUnsubscribe: boolean;
  prioritizeFollowUps: boolean;
}

export interface SequenceSummary {
  id: string;
  organizationId: string;
  executiveId: string;
  /** Who configured/published the sequence — distinct from `executiveId` (who operationally owns it) whenever an admin created it on an executive's behalf. */
  createdBy: string;
  mailboxId: string | null;
  mailboxEmail: string | null;
  name: string;
  description: string | null;
  status: SequenceStatus;
  timezone: string;
  schedule: SequenceSchedule;
  policies: SequencePolicies;
  managementDate: string | null;
  stepPolicy: SequenceStepPolicy;
  publishStatus: SequencePublishStatus | null;
  effectiveStartAt: string | null;
  sequenceVersion: number;
  lastPublishedAt: string | null;
  lastPublishCommandId: string | null;
  stepCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Spec §4 — the admin's global monitoring panel: one row of the "todas las secuencias" table. */
export interface AdminSequenceListRow {
  id: string;
  name: string;
  status: SequenceStatus;
  publishStatus: SequencePublishStatus | null;
  clientId: string | null;
  clientName: string | null;
  mailboxId: string | null;
  mailboxEmail: string | null;
  executiveId: string;
  executiveName: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  effectiveStartAt: string | null;
  prospectCount: number;
  sentStep1: number;
  sentStep2: number;
  sentStep3: number;
  repliedCount: number;
  bouncedCount: number;
  stoppedCount: number;
  errorCount: number;
  lastActivityAt: string | null;
}

export interface AdminSequenceResults {
  prospectCount: number;
  pendingCount: number;
  sentStep1: number;
  sentStep2: number;
  sentStep3: number;
  repliedCount: number;
  bouncedCount: number;
  stoppedCount: number;
  errorCount: number;
}

export interface AdminSequenceEvent {
  at: string;
  type: string;
  description: string;
}

export interface AdminSequenceStepContent {
  id: string;
  position: number;
  name: string;
  subject: string;
  htmlHeader: string | null;
  htmlBody: string;
  isSentSnapshot: boolean;
}

export interface AdminSequenceDetail {
  id: string;
  name: string;
  status: SequenceStatus;
  publishStatus: SequencePublishStatus | null;
  timezone: string;
  managementDate: string | null;
  effectiveStartAt: string | null;
  createdAt: string;
  clientId: string | null;
  clientName: string | null;
  mailboxId: string | null;
  mailboxEmail: string | null;
  executiveId: string;
  executiveName: string;
  createdBy: string;
  createdByName: string;
  results: AdminSequenceResults;
  events: AdminSequenceEvent[];
  steps: AdminSequenceStepContent[];
}

/** §5 — the wizard's "Configuración general" step: client + sender account + management date, all at once. */
export interface CreateWizardSequencePayload {
  clientId: string;
  mailboxId: string;
  managementDate: string;
}

/**
 * Admin equivalent of CreateWizardSequencePayload — used when the actor is
 * NOT the executive the sequence will belong to. If the mailbox isn't yet
 * assigned to the target executive, the request is rejected unless
 * `authorizeMailboxAssignment` is set, which grants it as part of the call.
 */
export interface CreateWizardSequenceForExecutivePayload extends CreateWizardSequencePayload {
  authorizeMailboxAssignment?: boolean;
}

export interface ReassignExecutivePayload {
  executiveId: string;
  reason?: string;
}

export interface CreateSequencePayload {
  name: string;
  description?: string;
  timezone: string;
}

export interface UpdateSequencePayload {
  name?: string;
  description?: string | null;
  timezone?: string;
  mailboxId?: string | null;
  schedule?: SequenceSchedule;
}

export interface SenderAccountInfo {
  mailboxId: string;
  email: string;
  fromName: string;
  dailyLimit: number | null;
  hasActiveSignature: boolean;
  signatureLabel: string | null;
  operational: boolean;
  issues: string[];
}

export interface ReadinessCheck {
  ok: boolean;
  issues: string[];
}

export interface PendingFeatureCheck {
  status: 'PENDING_FEATURE';
  message: string;
}

export interface SequenceReadiness {
  account: ReadinessCheck;
  steps: ReadinessCheck;
  prospects: PendingFeatureCheck;
  calendar: PendingFeatureCheck;
  overallReady: boolean;
}

export interface SchedulePreviewStep {
  stepId: string;
  position: number;
  name: string;
  estimatedAt: string;
}

/** §7 — "Envío estimado" per step, recalculated live from the sequence's current settings. */
export interface SchedulePreview {
  effectiveStartAt: string;
  steps: SchedulePreviewStep[];
}

export interface SequenceDeletionResult {
  id: string;
  deletedAt: string;
  previousStatus: SequenceStatus;
  cancelledJobs: number;
}

export type DelayUnit = 'MINUTES' | 'HOURS' | 'DAYS' | 'BUSINESS_DAYS';
export type StepSendMode = 'NEW_THREAD' | 'REPLY';
export type SequenceStepStatus = 'DRAFT' | 'PUBLISHED' | 'DISABLED' | 'ARCHIVED';

export interface SequenceStepSummary {
  id: string;
  sequenceId: string;
  position: number;
  name: string;
  subject: string;
  preheader: string | null;
  htmlHeader: string | null;
  htmlBody: string;
  plainTextBody: string;
  variables: string[];
  delayValue: number;
  delayUnit: DelayUnit;
  sendMode: StepSendMode;
  status: SequenceStepStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSequenceStepPayload {
  name: string;
  subject: string;
  preheader?: string;
  htmlHeader?: string | null;
  htmlBody: string;
  plainTextBody?: string;
  delayValue: number;
  delayUnit: DelayUnit;
  sendMode: StepSendMode;
}

export interface UpdateSequenceStepPayload {
  name?: string;
  subject?: string;
  preheader?: string | null;
  htmlHeader?: string | null;
  htmlBody?: string;
  plainTextBody?: string;
  delayValue?: number;
  delayUnit?: DelayUnit;
  sendMode?: StepSendMode;
  status?: SequenceStepStatus;
}

export interface SequenceStepVersionSummary {
  id: string;
  versionNumber: number;
  subject: string;
  preheader: string | null;
  htmlHeader: string | null;
  htmlBody: string;
  plainTextBody: string;
  delayValue: number;
  delayUnit: DelayUnit;
  sendMode: StepSendMode;
  createdBy: string;
  createdAt: string;
}

export interface SequenceStepPreview {
  subject: string;
  renderedSubject: string;
  preheader: string | null;
  renderedPreheader: string | null;
  htmlHeader: string | null;
  renderedHeader: string | null;
  renderedHtml: string;
  renderedPlainText: string;
  variables: string[];
  usesRealSenderData: boolean;
  signatureApplied: boolean;
  senderMailboxEmail: string;
}

export interface SendTestStepPayload {
  to: string;
}

export interface SendTestStepResult {
  accepted: boolean;
  message: string;
}

export interface InboxParticipant {
  name: string | null;
  email: string;
}

export interface InboxThreadSummary {
  id: string;
  subject: string;
  participants: InboxParticipant[];
  lastMessageAt: string;
  lastMessageSnippet: string;
  unreadCount: number;
  messageCount: number;
}

export interface InboxMessageSummary {
  id: string;
  threadId: string;
  from: InboxParticipant;
  to: InboxParticipant[];
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

// --- Client-hierarchy pivot: Organización → Cliente → Dominio → Cuenta → Conversaciones ---

export type ManagedClientStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export type ManagedClientSource = 'SERVER' | 'MANUAL';

export interface ManagedClientSummary {
  id: string;
  organizationId: string;
  source: ManagedClientSource;
  serverClientId: string | null;
  /** Snapshot local del nombre corporativo, reportado por el servidor externo. Ya no editable a mano. */
  name: string;
  legalName: string | null;
  internalCode: string | null;
  /** Snapshot local del rubro corporativo, reportado por el servidor externo. Ya no editable a mano. */
  industry: string | null;
  status: ManagedClientStatus;
  logoUrl: string | null;
  startDate: string | null;
  supervisorUserId: string | null;
  notes: string | null;
  /** Último RUT conocido, reportado por el servidor externo. Solo informativo. */
  clientRutSnapshot: string | null;
  /** Último estado normalizado conocido del servidor externo. Solo informativo. */
  externalStatusSnapshot: string | null;
  /** Cuándo se verificó por última vez contra el servidor externo. */
  externalStatusCheckedAt: string | null;
  domainCount: number;
  mailboxCount: number;
  sequenceCount: number;
  newConversationCount: number;
  pendingConversationCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ClientConfigurationStatus =
  | 'SIN_CONFIGURAR'
  | 'CONFIGURACION_INCOMPLETA'
  | 'CON_INCIDENCIAS'
  | 'CONFIGURADO';

/** Listado local puro de ManagedClient con su estado de configuración — ver GET /clients/overview. */
export interface AdminClientOverview {
  id: string;
  name: string;
  legalName: string | null;
  internalCode: string | null;
  industry: string | null;
  status: ManagedClientStatus;
  configurationStatus: ClientConfigurationStatus;
  domainCount: number;
  mailboxCount: number;
  assignedExecutiveCount: number;
}

export interface AdminClientsListResult {
  available: boolean;
  clients: AdminClientOverview[];
}

export interface UpdateManagedClientPayload {
  name?: string;
  legalName?: string | null;
  internalCode?: string | null;
  industry?: string | null;
  status?: ManagedClientStatus;
  logoUrl?: string | null;
  startDate?: string | null;
  supervisorUserId?: string | null;
  notes?: string | null;
}

export type ClientAssignmentRole = 'PRIMARY' | 'SECONDARY';

export interface ClientAssigneeSummary {
  id: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  role: ClientAssignmentRole;
}

export interface SetClientAssigneesPayload {
  primaryUserId: string | null;
  secondaryUserIds: string[];
}

export type DomainStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface DomainSummary {
  id: string;
  organizationId: string;
  clientId: string;
  clientName: string;
  domainName: string;
  status: DomainStatus;
  notes: string | null;
  mailboxCount: number;
  sequenceCount: number;
  newConversationCount: number;
  pendingConversationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDomainPayload {
  domainName: string;
  notes?: string;
}

export interface UpdateDomainPayload {
  domainName?: string;
  status?: DomainStatus;
  notes?: string | null;
}

// --- Centro de conversaciones ---

export type ConversationManagementStatus =
  'NEW' | 'PENDING' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED';

export type ConversationClassification =
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'REQUESTS_INFORMATION'
  | 'FOLLOW_UP_LATER'
  | 'WRONG_CONTACT'
  | 'OUT_OF_OFFICE'
  | 'AUTOMATIC_REPLY'
  | 'HARD_BOUNCE'
  | 'SOFT_BOUNCE'
  | 'UNSUBSCRIBE'
  | 'UNCLASSIFIED';

/**
 * The executive's deliberate business decision about a reply — distinct
 * from `ConversationClassification` (auto-detected from message content).
 * `NOT_INTERESTED`/`INTERESTED` stop the whole company's participation in
 * this sequence; `DO_NOT_CONTACT` excludes only this one contact; `REFERRED`
 * swaps this contact out for a new one within the same company/sequence.
 */
export type ResponseOutcome = 'NOT_INTERESTED' | 'DO_NOT_CONTACT' | 'INTERESTED' | 'REFERRED';

export type ConversationDirection = 'INBOUND' | 'OUTBOUND';

export type ConversationMessageType =
  | 'HUMAN_REPLY'
  | 'OUTREACH_EMAIL'
  | 'AUTO_REPLY'
  | 'OUT_OF_OFFICE'
  | 'HARD_BOUNCE'
  | 'SOFT_BOUNCE'
  | 'UNSUBSCRIBE'
  | 'UNKNOWN';

export interface ConversationSummary {
  id: string;
  organizationId: string;
  clientId: string | null;
  clientName: string | null;
  domainId: string | null;
  domainName: string | null;
  mailboxId: string;
  mailboxEmail: string;
  contactEmail: string;
  contactName: string | null;
  contactId: string | null;
  companyId: string | null;
  companyName: string | null;
  sequenceId: string | null;
  sequenceName: string | null;
  sequenceStepId: string | null;
  originatingStepName: string | null;
  originatingStepPosition: number | null;
  /** The CONTACT's (the person, not the company) participation status in `sequenceId` — distinct from `managementStatus` (this conversation's own triage state). */
  contactStatus: SequenceContactStatus | null;
  responseOutcome: ResponseOutcome | null;
  assignedExecutiveId: string | null;
  assignedExecutiveName: string | null;
  subject: string;
  managementStatus: ConversationManagementStatus;
  classification: ConversationClassification;
  isUnread: boolean;
  lastMessageAt: string;
  resolvedAt: string | null;
  archivedAt: string | null;
  tagIds: string[];
  isUnmatched: boolean;
  /** "Conversaciones de prueba" (QA) — true only for a synthetic row created by "Generar conversaciones de prueba". */
  isSimulation: boolean;
  /** Set only when isSimulation — the SUGGESTED scenario, shown as a hint only; never equal to the actual classification unless an admin picked it manually. */
  simulationScenario: ResponseOutcome | null;
  createdAt: string;
}

export interface ConversationMessageSummary {
  id: string;
  direction: ConversationDirection;
  senderEmail: string;
  senderName: string | null;
  recipients: string[];
  cc: string[];
  subject: string;
  htmlBody: string;
  plainTextBody: string;
  receivedAt: string | null;
  sentAt: string | null;
  messageType: ConversationMessageType;
}

export interface ConversationNoteSummary {
  id: string;
  authorUserId: string;
  authorName: string;
  content: string;
  /** Set when this note was auto-created from the "Resultado de la respuesta" modal — null for manually-added notes. */
  responseOutcome: ResponseOutcome | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessageSummary[];
  notes: ConversationNoteSummary[];
}

export interface ConversationCounters {
  total: number;
  new: number;
  pending: number;
  /** Count of conversations unread for the specific caller, never a global count. */
  unread: number;
}

export interface ConversationTagSummary {
  id: string;
  organizationId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationTagPayload {
  name: string;
  color: string;
}

export interface UpdateConversationTagPayload {
  name?: string;
  color?: string;
}

export interface CreateConversationNotePayload {
  content: string;
}

export interface UpdateConversationNotePayload {
  content: string;
}

export interface UpdateConversationStatusPayload {
  managementStatus: ConversationManagementStatus;
}

export interface UpdateConversationClassificationPayload {
  classification: ConversationClassification;
}

export interface UpdateConversationAssignmentPayload {
  assignedExecutiveId: string | null;
}

export interface AssociateConversationPayload {
  clientId?: string | null;
  domainId?: string | null;
  sequenceId?: string | null;
}

// ---------------------------------------------------------------------
// Mail-engine simulation phase — command/event contracts, mailbox
// provisioning, sequence publishing, contact imports, scheduling, and
// reply simulation. See apps/api's domain/integration/* for the backend
// source of truth these mirror.
// ---------------------------------------------------------------------

export type CommandType =
  | 'MAILBOX_PROVISION_REQUESTED'
  | 'SEQUENCE_PUBLISH_REQUESTED'
  | 'SEQUENCE_IMPORT_REQUESTED'
  | 'SEQUENCE_CONTACT_REMOVE_REQUESTED'
  | 'SEQUENCE_COMPANY_REMOVE_REQUESTED';

export type EventType =
  | 'MAILBOX_PROVISION_ACCEPTED'
  | 'MAILBOX_PROVISION_STARTED'
  | 'MAILBOX_IMAP_VALIDATED'
  | 'MAILBOX_SMTP_VALIDATED'
  | 'MAILBOX_PROVISION_COMPLETED'
  | 'MAILBOX_PROVISION_FAILED'
  | 'SEQUENCE_PUBLISH_ACCEPTED'
  | 'SEQUENCE_PUBLISH_COMPLETED'
  | 'SEQUENCE_IMPORT_ACCEPTED'
  | 'SEQUENCE_IMPORT_PROCESSING'
  | 'SEQUENCE_IMPORT_BATCH_COMPLETED'
  | 'SEQUENCE_IMPORT_COMPLETED'
  | 'SEQUENCE_IMPORT_PARTIALLY_COMPLETED'
  | 'SEQUENCE_IMPORT_FAILED'
  | 'CONTACT_SCHEDULED'
  | 'EMAIL_QUEUED'
  | 'EMAIL_SENT'
  | 'EMAIL_FAILED'
  | 'EMAIL_RETRY_SCHEDULED'
  | 'EMAIL_CANCELLED'
  | 'SEQUENCE_CONTACT_REMOVED'
  | 'SEQUENCE_COMPANY_REMOVED'
  | 'INBOUND_REPLY_MATCHED'
  | 'INBOUND_REPLY_UNMATCHED';

export type CommandStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMEOUT';

export type AggregateType = 'MAILBOX' | 'SEQUENCE' | 'SEQUENCE_IMPORT' | 'SEQUENCE_CONTACT' | 'SEQUENCE_COMPANY';

export interface IntegrationCommand {
  id: string;
  organizationId: string;
  commandId: string;
  commandType: CommandType;
  aggregateType: AggregateType;
  aggregateId: string;
  schemaVersion: string;
  idempotencyKey: string;
  correlationId: string;
  /** Already redacted by the backend (secrets replaced with `[REDACTED]`) before this ever reaches the frontend. */
  payload: Record<string, unknown>;
  status: CommandStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  requestedBy: string;
  createdAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
}

export type EventProcessingStatus = 'RECEIVED' | 'PROCESSED' | 'FAILED';

export interface IntegrationEvent {
  id: string;
  organizationId: string;
  eventId: string;
  eventType: EventType;
  commandId: string | null;
  correlationId: string;
  schemaVersion: string;
  payload: Record<string, unknown>;
  status: EventProcessingStatus;
  origin: 'SIMULATED' | 'REMOTE';
  receivedAt: string;
  processedAt: string | null;
  processingError: string | null;
}

export interface IntegrationSummary {
  mailEngineMode: 'simulation' | 'remote';
  totalCommands: number;
  commandsByStatus: Record<string, number>;
  totalEvents: number;
  eventsByStatus: Record<string, number>;
}

export interface AdvanceResultPayload {
  mailbox?: MailboxSummary;
  sequence?: SequenceSummary;
  import?: SequenceImportSummary;
  events: IntegrationEvent[];
}

export type MailboxProvisionScenario =
  | 'SUCCESS'
  | 'IMAP_ERROR'
  | 'SMTP_ERROR'
  | 'AUTH_ERROR'
  | 'TIMEOUT'
  | 'GENERAL_FAILURE';

export interface RequestProvisioningResult {
  mailbox: MailboxSummary;
  command: IntegrationCommand;
  duplicate: boolean;
}

export interface ProvisioningCommandView {
  command: IntegrationCommand | null;
  plannedEvents: IntegrationEventEnvelope[];
  recordedEvents: IntegrationEvent[];
}

/** The envelope shape returned by `listPlannedEvents` — not yet persisted, so no `id`/`receivedAt`/`status`. */
export interface IntegrationEventEnvelope {
  schemaVersion: string;
  eventId: string;
  eventType: EventType;
  commandId: string | null;
  correlationId: string;
  organizationId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export type SequenceImportStatus =
  | 'UPLOADED'
  | 'MAPPING_REQUIRED'
  | 'VALIDATING'
  | 'READY'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'PARTIALLY_COMPLETED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type ImportScenario =
  | 'ALL_ACCEPTED'
  | 'WITH_DUPLICATES'
  | 'WITH_INVALID'
  | 'WITH_EXCLUDED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'TIMEOUT';

export interface ColumnMapping {
  email: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  company?: string;
  jobTitle?: string;
  phone?: string;
  city?: string;
  country?: string;
  website?: string;
  linkedin?: string;
  customFields?: Record<string, string>;
}

export interface ImportRejection {
  row: number;
  reason: 'INVALID_EMAIL' | 'DUPLICATE' | 'EXCLUDED_CONTACT' | 'EXCLUDED_COMPANY' | 'MISSING_REQUIRED_FIELD';
  detail: string;
}

export interface SequenceImportSummary {
  id: string;
  organizationId: string;
  clientId: string;
  sequenceId: string;
  executiveId: string;
  mailboxId: string;
  status: SequenceImportStatus;
  fileName: string;
  storageKey: string;
  checksum: string;
  columnMapping: ColumnMapping | null;
  scenario: ImportScenario | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  excludedRows: number;
  companiesDetected: number;
  contactsAccepted: number;
  contactsRejected: number;
  rejections: ImportRejection[];
  commandId: string | null;
  lastError: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UploadImportResult {
  import: SequenceImportSummary;
  headers: string[];
  previewRows: Record<string, string>[];
}

export interface ConfirmImportResult {
  import: SequenceImportSummary;
  command: IntegrationCommand;
  duplicate: boolean;
}

export type SequenceContactStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'SCHEDULED'
  | 'REPLIED'
  | 'BOUNCED'
  | 'UNSUBSCRIBED'
  | 'COMPLETED'
  | 'COMPLETED_MANUALLY'
  | 'PAUSED'
  | 'REMOVED'
  | 'ERROR';

export interface SequenceContactSummary {
  id: string;
  contactId: string;
  email: string;
  fullName: string | null;
  companyId: string | null;
  companyName: string | null;
  currentStepPosition: number | null;
  status: SequenceContactStatus;
  nextScheduledAt: string | null;
  lastSentAt: string | null;
  repliedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
}

export interface SequenceCompanySummary {
  companyId: string;
  companyName: string;
  totalContacts: number;
  activeContacts: number;
  scheduledContacts: number;
  repliedContacts: number;
  completedContacts: number;
  removedContacts: number;
}

export interface RemoveSequenceContactResult {
  contact: SequenceContactSummary;
  command: IntegrationCommand;
  duplicate: boolean;
  cancelledJobs: number;
}

export interface RemoveSequenceCompanyResult {
  command: IntegrationCommand;
  duplicate: boolean;
  cancelledJobs: number;
  affectedContacts: number;
}

export type ScheduledEmailStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'RETRY_SCHEDULED'
  | 'FAILED'
  | 'CANCELLED';

export type ScheduledEmailPriority = 'FOLLOW_UP' | 'NEW_CONTACT';

export interface ScheduledEmailSummary {
  id: string;
  organizationId: string;
  sequenceId: string;
  sequenceVersion: number;
  sequenceContactId: string;
  contactId: string;
  companyId: string | null;
  sequenceStepId: string;
  stepVersion: number;
  mailboxId: string;
  batchId: string;
  scheduledAt: string;
  status: ScheduledEmailStatus;
  priority: ScheduledEmailPriority;
  attemptCount: number;
  lastError: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  sentAt: string | null;
  subjectSnapshot: string | null;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBatchResult {
  batchId: string;
  followUps: number;
  newContacts: number;
  total: number;
  scheduledEmails: ScheduledEmailSummary[];
}

export type SimulateSendOutcome = 'SENT' | 'RETRY' | 'FAILED';

export type ReplyScenario = ConversationClassification | 'UNIDENTIFIED';

export interface SimulateReplyResult {
  event: IntegrationEvent;
  conversation: ConversationSummary | null;
}

// ---------------------------------------------------------------------
// Executive "Cuentas de correos" workspace — Cliente → Dominio → Cuenta
// tree with aggregated unread counts, and prospect-scoped sequence
// control reachable from a conversation's own 3-dot menu.
// ---------------------------------------------------------------------

export interface ConversationTreeMailboxNode {
  id: string;
  email: string;
  unreadCount: number;
}

export interface ConversationTreeDomainNode {
  id: string;
  domainName: string;
  unreadCount: number;
  mailboxes: ConversationTreeMailboxNode[];
}

export interface ConversationTreeClientNode {
  id: string;
  name: string;
  unreadCount: number;
  domains: ConversationTreeDomainNode[];
}

export interface ContactSummary {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  companyId: string | null;
  suppressed: boolean;
  suppressedAt: string | null;
  suppressedReason: string | null;
}

/** §7-8 of the response-outcome model — one command per action, same envelope shape as the rest of this simulation phase. */
export interface CompanyResponseOutcomeResult {
  conversation: ConversationSummary;
  command: IntegrationCommand;
  cancelledJobs: number;
  affectedContacts: number;
}

export interface DoNotContactResult {
  conversation: ConversationSummary;
  contact: ContactSummary;
  command: IntegrationCommand;
  cancelledJobs: number;
  affectedSequences: number;
}

export interface ReferProspectPayload {
  newContactEmail: string;
  newContactFirstName?: string;
  newContactLastName?: string;
  sendFirstStepImmediately: boolean;
}

export interface ReferProspectResult {
  conversation: ConversationSummary;
  removedSequenceContact: SequenceContactSummary;
  newContact: ContactSummary;
  newSequenceContact: SequenceContactSummary;
  command: IntegrationCommand;
  sentImmediately: boolean;
}
