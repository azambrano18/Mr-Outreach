import {
  ExecutionControlCommandInput,
  ExecutionControlCommandResult,
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

  /**
   * Fase "Control operativo de Gestiones" — pause/resume/stop a running (or
   * paused) Gestión. All three share `ExecutionControlCommandInput`/
   * `ExecutionControlCommandResult` and the same idempotent-by-key,
   * never-throws-for-a-well-formed-request contract as `startExecution`.
   * There is deliberately no `restartExecution`: a restart's actual
   * dispatch is a brand new Gestión attempt, submitted through the
   * existing `startExecution` for the new local execution row — see
   * RestartSequenceExecutionUseCase.
   */
  pauseExecution(input: ExecutionControlCommandInput): Promise<ExecutionControlCommandResult>;
  resumeExecution(input: ExecutionControlCommandInput): Promise<ExecutionControlCommandResult>;
  stopExecution(input: ExecutionControlCommandInput): Promise<ExecutionControlCommandResult>;
}

export const SEQUENCE_EXECUTION_MOTOR_PORT = Symbol('SEQUENCE_EXECUTION_MOTOR_PORT');
