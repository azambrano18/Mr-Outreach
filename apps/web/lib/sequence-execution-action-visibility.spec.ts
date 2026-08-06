import { getSequenceExecutionActionVisibility } from './sequence-execution-action-visibility';
import type { SequenceExecutionControlCapabilities } from './sequence-execution-types';

const NONE: SequenceExecutionControlCapabilities = { canPause: false, canResume: false, canStop: false, canRestart: false };

describe('getSequenceExecutionActionVisibility — real integration point behind the Monitor de gestiones buttons', () => {
  it('ACCEPTED + QUEUED + ADMIN with sequence_executions.stop_all → shows Detener', () => {
    const visibility = getSequenceExecutionActionVisibility({ ...NONE, canStop: true }, false);
    expect(visibility.showStop).toBe(true);
    expect(visibility.showPause).toBe(false);
    expect(visibility.showResume).toBe(false);
    expect(visibility.showRestart).toBe(false);
    expect(visibility.showNoActionsMessage).toBe(false);
  });

  it('ACCEPTED + QUEUED + ADMIN WITHOUT the permission → does not show Detener', () => {
    const visibility = getSequenceExecutionActionVisibility(NONE, false);
    expect(visibility.showStop).toBe(false);
    expect(visibility.showNoActionsMessage).toBe(true);
  });

  it('RUNNING + ADMIN → shows Pausar and Detener', () => {
    const visibility = getSequenceExecutionActionVisibility({ ...NONE, canPause: true, canStop: true }, false);
    expect(visibility.showPause).toBe(true);
    expect(visibility.showStop).toBe(true);
    expect(visibility.showResume).toBe(false);
    expect(visibility.showRestart).toBe(false);
  });

  it('PAUSED + ADMIN → shows Reanudar and Detener', () => {
    const visibility = getSequenceExecutionActionVisibility({ ...NONE, canResume: true, canStop: true }, false);
    expect(visibility.showResume).toBe(true);
    expect(visibility.showStop).toBe(true);
    expect(visibility.showPause).toBe(false);
  });

  it('STOPPED + ADMIN → shows Reiniciar only', () => {
    const visibility = getSequenceExecutionActionVisibility({ ...NONE, canRestart: true }, false);
    expect(visibility.showRestart).toBe(true);
    expect(visibility.showPause).toBe(false);
    expect(visibility.showResume).toBe(false);
    expect(visibility.showStop).toBe(false);
    expect(visibility.showNoActionsMessage).toBe(false);
  });

  it('COMPLETED → no action, shows the "no actions available" message', () => {
    const visibility = getSequenceExecutionActionVisibility(NONE, false);
    expect(visibility.showPause).toBe(false);
    expect(visibility.showResume).toBe(false);
    expect(visibility.showStop).toBe(false);
    expect(visibility.showRestart).toBe(false);
    expect(visibility.showNoActionsMessage).toBe(true);
  });

  it('EXECUTIVE (every capability false, no admin permissions at all) → no administrative action shown', () => {
    const visibility = getSequenceExecutionActionVisibility(NONE, false);
    expect(visibility.showPause).toBe(false);
    expect(visibility.showResume).toBe(false);
    expect(visibility.showStop).toBe(false);
    expect(visibility.showRestart).toBe(false);
  });

  it('a transitional control state in flight suppresses the "no actions available" message even with every capability false', () => {
    const visibility = getSequenceExecutionActionVisibility(NONE, true);
    expect(visibility.showNoActionsMessage).toBe(false);
  });
});
