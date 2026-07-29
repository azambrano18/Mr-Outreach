import {
  PublishSequenceTemplateInput,
  PublishSequenceTemplateResult,
  SequenceTemplateStatusSnapshot,
  UpdateSequenceTemplateInput,
  UpdateSequenceTemplateResult,
} from './sequence-template-motor.types';

/**
 * §10 — the rest of the application depends on this port, never on
 * `SimulatedSequenceTemplateMotorAdapter`/`HttpSequenceTemplateMotorAdapter`
 * directly, same rule as `MailboxMotorPort`. Responsibilities limited to
 * publishing a Plantilla version and reading back its status — never
 * mixed with prospect import or execution (`SequenceExecutionMotorPort`
 * owns that), per §10's explicit instruction.
 */
export interface SequenceTemplateMotorPort {
  /**
   * Idempotent by `idempotencyKey`: a retried publish of the same version
   * returns the identical receipt rather than creating a second server
   * template. Never throws for a well-formed, reachable request — a
   * business rejection is `{accepted: false, status: 'FAILED', ...}`, not
   * an exception. Throws `ServiceUnavailableException` only when the
   * motor itself can't be reached (fail-closed — callers must not
   * publish/proceed on that path).
   */
  publishTemplate(input: PublishSequenceTemplateInput): Promise<PublishSequenceTemplateResult>;

  /**
   * §12-17 — a SEPARATE command from `publishTemplate`, used only to update
   * a template that is already PUBLISHED. Idempotent by `idempotencyKey`.
   * Never throws for a well-formed, reachable request — a business
   * rejection is `{accepted: false, status: 'FAILED', ...}`. Throws
   * `ServiceUnavailableException` only when the motor can't be reached;
   * callers must leave the previously-published version untouched on that path.
   */
  updateTemplate(input: UpdateSequenceTemplateInput): Promise<UpdateSequenceTemplateResult>;

  /** Throws `ServiceUnavailableException` if the motor can't be reached. */
  getTemplateStatus(serverTemplateId: string): Promise<SequenceTemplateStatusSnapshot>;
}

export const SEQUENCE_TEMPLATE_MOTOR_PORT = Symbol('SEQUENCE_TEMPLATE_MOTOR_PORT');
