/**
 * DRAFT is the only fully-editable state. PAUSED/ARCHIVED exist so the
 * executive-profile UI can offer pause/resume/archive/restore as the
 * request asks for — there is deliberately no ACTIVE/READY/COMPLETED
 * state yet: activating a sequence would be pure theater until a
 * scheduler/worker exists to actually consume it (not built in this
 * phase — see README > "Fase 10"). Reaching PAUSED/ARCHIVED from DRAFT
 * and back is the full state machine for now.
 */
export type SequenceStatus = 'DRAFT' | 'PAUSED' | 'ARCHIVED';

/**
 * FLEXIBLE is the original free-form step editing model (add/remove/reorder/
 * rename), still used by the generic `/me/sequences` API and its e2e tests.
 * FIXED_3 is the new creation-wizard model ("Desarrollo de la nueva función
 * Secuencias" §10): exactly three steps named Enviados_1/2/3, created
 * automatically and never addable/removable/renameable/reorderable —
 * enforced in `SequenceStepsService`, not by narrowing the underlying API.
 */
export type SequenceStepPolicy = 'FLEXIBLE' | 'FIXED_3';

/**
 * Mirrors the engine-reported lifecycle of the last "Publicar secuencia"
 * command (§23) — null until the sequence has been published at least
 * once. Distinct from `SequenceStatus` (the DRAFT/PAUSED/ARCHIVED editing
 * lifecycle): this is what the engine says is happening to the already
 * published content, driven by `SimulatedMailEngineAdapter` the same way
 * `SequenceImport.status` already is.
 */
export type SequencePublishStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/** §16 — the calendar half of a published sequence's schedule. */
export interface SequenceSchedule {
  /** ISO weekday abbreviations, e.g. ['MON','TUE','WED','THU','FRI']. */
  days: string[];
  windows: Array<{ start: string; end: string }>;
}

/** §14/§16 — stop rules + follow-up priority, carried in every SEQUENCE_PUBLISH_REQUESTED command. */
export interface SequencePolicies {
  stopOnReply: boolean;
  stopOnHardBounce: boolean;
  stopOnUnsubscribe: boolean;
  prioritizeFollowUps: boolean;
}

export interface Sequence {
  id: string;
  organizationId: string;
  executiveId: string;
  /** Null until step 2 ("cuenta remitente") is completed. */
  mailboxId: string | null;
  /**
   * Deduced from `mailboxId` (never set directly by a public DTO) — see
   * SequencesService.update, which stamps this whenever the sender account
   * changes. Kept denormalized on the sequence itself (rather than always
   * joining through Mailbox → Domain → Client) so permission checks,
   * reports and the client-scoped conversation counts can filter
   * sequences by client without an extra join, per the client-hierarchy
   * pivot's explicit request. Null whenever the mailbox itself has no
   * client yet ("Pendiente de clasificación").
   */
  clientId: string | null;
  name: string;
  description: string | null;
  status: SequenceStatus;
  timezone: string;
  schedule: SequenceSchedule;
  policies: SequencePolicies;
  /** YYYY-MM-DD "fecha de gestión" chosen in wizard step 1 — null for sequences created via the generic (pre-wizard) API. */
  managementDate: string | null;
  stepPolicy: SequenceStepPolicy;
  publishStatus: SequencePublishStatus | null;
  /** §6/§20 — frozen at the moment of a successful publish; null before the first publish (or for FLEXIBLE sequences without a managementDate). */
  effectiveStartAt: Date | null;
  /**
   * §16 — 0 until the first "Publicar secuencia"; incremented only when a
   * publish actually changes something publish-relevant (steps, subjects,
   * bodies, delays, schedule, policies or sender account) since the last
   * publish. Sent messages/jobs snapshot the version active when they were
   * created (see ScheduledEmail.sequenceVersion) — bumping this never
   * rewrites history.
   */
  sequenceVersion: number;
  lastPublishedAt: Date | null;
  lastPublishCommandId: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateSequenceInput {
  organizationId: string;
  executiveId: string;
  name: string;
  description?: string | null;
  timezone: string;
  createdBy: string;
  managementDate?: string | null;
  stepPolicy?: SequenceStepPolicy;
  schedule?: SequenceSchedule;
}

export interface UpdateSequenceInput {
  name?: string;
  description?: string | null;
  timezone?: string;
  /** Reassigns the operational owner — set only by SequencesService.reassignExecutive(), never createdBy. */
  executiveId?: string;
  schedule?: SequenceSchedule;
  policies?: Partial<SequencePolicies>;
  mailboxId?: string | null;
  /** Set alongside `mailboxId` by SequencesService, never independently by a public DTO. */
  clientId?: string | null;
  status?: SequenceStatus;
  sequenceVersion?: number;
  lastPublishedAt?: Date | null;
  lastPublishCommandId?: string | null;
  publishStatus?: SequencePublishStatus | null;
  effectiveStartAt?: Date | null;
  updatedBy?: string;
  /** Soft-delete marker — set by SequencesService.remove(), never by a public DTO. */
  deletedAt?: Date | null;
}
