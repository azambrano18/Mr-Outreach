import { SequenceExecutionStatus } from '../../domain/sequence-execution/sequence-execution.entity';
import { CONTROL_TRANSITIONS, ControlAction } from './control-transitions';

export interface SequenceExecutionControlCapabilities {
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  canRestart: boolean;
}

const PERMISSION_FOR_ACTION: Record<ControlAction, string> = {
  PAUSE: 'sequence_executions.pause_all',
  RESUME: 'sequence_executions.resume_all',
  STOP: 'sequence_executions.stop_all',
};

const RESTART_PERMISSION = 'sequence_executions.restart_all';

/**
 * The single, authoritative, backend-computed answer to "which control
 * actions should be visible right now" — derives directly from
 * CONTROL_TRANSITIONS.allowedFrom (never a second, hand-copied status list)
 * so the API response and the button that reads it can never silently
 * drift apart again. Depends only on `status` + the caller's own permission
 * keys — never on serverStatus, pendingCount, sentCount, or startedAt.
 */
export function computeExecutionControlCapabilities(
  status: SequenceExecutionStatus,
  permissionKeys: readonly string[],
): SequenceExecutionControlCapabilities {
  const has = (key: string): boolean => permissionKeys.includes(key);
  return {
    canPause: has(PERMISSION_FOR_ACTION.PAUSE) && CONTROL_TRANSITIONS.PAUSE.allowedFrom.includes(status),
    canResume: has(PERMISSION_FOR_ACTION.RESUME) && CONTROL_TRANSITIONS.RESUME.allowedFrom.includes(status),
    canStop: has(PERMISSION_FOR_ACTION.STOP) && CONTROL_TRANSITIONS.STOP.allowedFrom.includes(status),
    // RESTART has no CONTROL_TRANSITIONS entry (it creates a new execution row rather than
    // transitioning this one) — its own use case's only precondition is status === 'STOPPED'.
    canRestart: has(RESTART_PERMISSION) && status === 'STOPPED',
  };
}
