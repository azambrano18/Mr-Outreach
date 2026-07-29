import {
  PublishSequenceTemplateInput,
  PublishSequenceTemplateResult,
  SequenceTemplateStatusSnapshot,
} from './sequence-template-motor.types';

/**
 * §10 — the rest of the application depends on this port, never on
 * `SimulatedSequenceTemplateMotorAdapter`/`HttpSequenceTemplateMotorAdapter`
 * directly, same rule as `MailboxMotorPort`. Responsibilities limited to
 * publishing a Plantilla version and reading back its status — never
 * mixed with prospect import or execution (`SequenceExecutionMotorPort`
 * owns that), per §10's explicit instruction.
 *
 * Consolidación contractual — there is only ONE publish command now.
 * Editing an already-published template (§12-17) calls this exact same
 * `publishTemplate` method again, passing `previousServerTemplateId`; it
 * never reuses the previous version's `serverTemplateId` and never asks
 * Railway to update/re-scope any existing job. A separate `updateTemplate`
 * command used to exist for that "update in place" semantics — retired.
 */
export interface SequenceTemplateMotorPort {
  /**
   * Idempotent by `idempotencyKey`: a retried publish of the same version
   * returns the identical receipt rather than creating a second server
   * template. Every accepted call — first publish or a later version —
   * returns a brand-new, unique `serverTemplateId`. Never throws for a
   * well-formed, reachable request — a business rejection is
   * `{accepted: false, status: 'FAILED', ...}`, not an exception. Throws
   * `ServiceUnavailableException` only when the motor itself can't be
   * reached (fail-closed — callers must not publish/proceed on that path).
   */
  publishTemplate(input: PublishSequenceTemplateInput): Promise<PublishSequenceTemplateResult>;

  /** Throws `ServiceUnavailableException` if the motor can't be reached. */
  getTemplateStatus(serverTemplateId: string): Promise<SequenceTemplateStatusSnapshot>;
}

export const SEQUENCE_TEMPLATE_MOTOR_PORT = Symbol('SEQUENCE_TEMPLATE_MOTOR_PORT');
