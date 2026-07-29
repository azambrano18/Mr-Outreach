import {
  SequenceExecutionStatusSnapshot,
  StartSequenceExecutionInput,
  StartSequenceExecutionResult,
} from './sequence-execution-motor.types';

/**
 * §18 — the rest of the application depends on this port, never on the
 * adapters directly. Responsibilities limited to starting a Gestión and
 * reading back its status — never mixed with `MailboxMotorPort` or
 * `SequenceTemplateMotorPort` (§18's explicit instruction).
 */
export interface SequenceExecutionMotorPort {
  /**
   * Idempotent by `idempotencyKey`. Never throws for a well-formed,
   * reachable request — a business rejection is `{accepted: false, status:
   * 'FAILED', ...}`. Throws `ServiceUnavailableException` only when the
   * motor can't be reached (fail-closed).
   *
   * §19 — the domain layer always calls this once per Gestión with the
   * full prospect list; if a real HTTP adapter later needs to batch
   * requests to stay under a request-size limit, that batching lives
   * entirely inside the adapter, never leaking into this method's
   * contract or into callers.
   */
  startExecution(input: StartSequenceExecutionInput): Promise<StartSequenceExecutionResult>;

  /** Throws `ServiceUnavailableException` if the motor can't be reached. */
  getExecutionStatus(serverExecutionId: string): Promise<SequenceExecutionStatusSnapshot>;
}

export const SEQUENCE_EXECUTION_MOTOR_PORT = Symbol('SEQUENCE_EXECUTION_MOTOR_PORT');
