import { SequenceExecutionStatus } from '../../domain/sequence-execution/sequence-execution.entity';
import { MotorEventType } from '../../modules/integration/dto/motor-event-envelope.dto';

export type ControlAction = 'PAUSE' | 'RESUME' | 'STOP';

export interface ControlTransition {
  allowedFrom: SequenceExecutionStatus[];
  transitional: SequenceExecutionStatus;
  terminal: SequenceExecutionStatus;
  acceptedEventType: MotorEventType;
  terminalEventType: MotorEventType;
}

/**
 * Fase "Control operativo de Gestiones" — RUNNING -> PAUSE_REQUESTED ->
 * PAUSED; PAUSED -> RESUME_REQUESTED -> RUNNING; {RUNNING,PAUSED,ACCEPTED}
 * -> STOP_REQUESTED -> STOPPED. Every other current status (including every
 * *_REQUESTED transitional value for a DIFFERENT action, DRAFT, and every
 * terminal value) is rejected with 409 — this table is the single source
 * of truth other than the equally-authoritative
 * `conditionalUpdateStatusFromAllowed` claim in the DB itself, AND the only
 * source `computeExecutionControlCapabilities` reads to decide the visible
 * "Detener/Pausar/Reanudar" buttons — never a second, hand-copied list.
 *
 * Extracted to its own module (no other imports) so ControlSequenceExecutionUseCase
 * (which depends on SequenceExecutionsService) and execution-control-capabilities.ts
 * (which SequenceExecutionsService depends on) can both import this constant without
 * forming an import cycle back into ControlSequenceExecutionUseCase — that cycle
 * previously broke Nest's DI metadata resolution for SequenceExecutionsService.
 *
 * ACCEPTED (server-side QUEUED — see LOCAL_STATUS_FOR_SERVER_STATUS in
 * refresh-execution-status.use-case.ts) is in STOP.allowedFrom to close a real gap:
 * a Gestión the motor already accepted but has not yet started dispatching had no
 * way to be stopped, which also permanently blocked deleting its mailbox (ACCEPTED
 * is non-terminal per NON_TERMINAL_EXECUTION_STATUSES in delete-mailbox.use-case.ts).
 * There is deliberately no separate REQUESTED/QUEUED/STARTING local status — the
 * project already represents "sent but not started" as ACCEPTED.
 */
export const CONTROL_TRANSITIONS: Record<ControlAction, ControlTransition> = {
  PAUSE: {
    allowedFrom: ['RUNNING'],
    transitional: 'PAUSE_REQUESTED',
    terminal: 'PAUSED',
    acceptedEventType: 'EXECUTION_PAUSE_ACCEPTED',
    terminalEventType: 'EXECUTION_PAUSED',
  },
  RESUME: {
    allowedFrom: ['PAUSED'],
    transitional: 'RESUME_REQUESTED',
    terminal: 'RUNNING',
    acceptedEventType: 'EXECUTION_RESUME_ACCEPTED',
    terminalEventType: 'EXECUTION_RESUMED',
  },
  STOP: {
    allowedFrom: ['RUNNING', 'PAUSED', 'ACCEPTED'],
    transitional: 'STOP_REQUESTED',
    terminal: 'STOPPED',
    acceptedEventType: 'EXECUTION_STOP_ACCEPTED',
    terminalEventType: 'EXECUTION_STOPPED',
  },
};
