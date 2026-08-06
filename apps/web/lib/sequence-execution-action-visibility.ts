import type { SequenceExecutionControlCapabilities } from './sequence-execution-types';

export interface SequenceExecutionActionVisibility {
  showPause: boolean;
  showResume: boolean;
  showStop: boolean;
  showRestart: boolean;
  showNoActionsMessage: boolean;
}

/**
 * The single place that decides which "Control operativo de la gestión"
 * buttons render. Reads only `controlCapabilities` (backend-authoritative —
 * already combines the Gestión's status with the current user's permission
 * keys via CONTROL_TRANSITIONS) plus whether a transitional control state is
 * in flight. Never re-derives eligibility from serverStatus, pendingCount,
 * sentCount, or startedAt — none of those are inputs here, so a Gestión
 * accepted-but-not-started (ACCEPTED/QUEUED) is decided purely by
 * `capabilities.canStop`, exactly like every other status.
 */
export function getSequenceExecutionActionVisibility(
  capabilities: SequenceExecutionControlCapabilities,
  isTransitionalControlState: boolean,
): SequenceExecutionActionVisibility {
  const { canPause, canResume, canStop, canRestart } = capabilities;
  return {
    showPause: canPause,
    showResume: canResume,
    showStop: canStop,
    showRestart: canRestart,
    showNoActionsMessage: !canPause && !canResume && !canStop && !canRestart && !isTransitionalControlState,
  };
}
