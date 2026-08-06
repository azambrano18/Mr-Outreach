import { computeExecutionControlCapabilities } from './execution-control-capabilities';

const ADMIN_PERMISSIONS = [
  'sequence_executions.pause_all',
  'sequence_executions.resume_all',
  'sequence_executions.stop_all',
  'sequence_executions.restart_all',
];

describe('computeExecutionControlCapabilities — real integration point behind "Detener gestión"', () => {
  it('ACCEPTED + ADMIN with sequence_executions.stop_all → canStop true, regardless of serverStatus/pendingCount (not inputs to this function)', () => {
    const caps = computeExecutionControlCapabilities('ACCEPTED', ADMIN_PERMISSIONS);
    expect(caps.canStop).toBe(true);
    expect(caps.canPause).toBe(false);
    expect(caps.canResume).toBe(false);
    expect(caps.canRestart).toBe(false);
  });

  it('ACCEPTED + ADMIN WITHOUT sequence_executions.stop_all → canStop false (permission-sync gap reproduced)', () => {
    const caps = computeExecutionControlCapabilities('ACCEPTED', []);
    expect(caps.canStop).toBe(false);
  });

  it('RUNNING + full admin permissions → canPause and canStop true, canResume/canRestart false', () => {
    const caps = computeExecutionControlCapabilities('RUNNING', ADMIN_PERMISSIONS);
    expect(caps).toEqual({ canPause: true, canResume: false, canStop: true, canRestart: false });
  });

  it('PAUSED + full admin permissions → canResume and canStop true, canPause/canRestart false', () => {
    const caps = computeExecutionControlCapabilities('PAUSED', ADMIN_PERMISSIONS);
    expect(caps).toEqual({ canPause: false, canResume: true, canStop: true, canRestart: false });
  });

  it('STOPPED + full admin permissions → only canRestart true', () => {
    const caps = computeExecutionControlCapabilities('STOPPED', ADMIN_PERMISSIONS);
    expect(caps).toEqual({ canPause: false, canResume: false, canStop: false, canRestart: true });
  });

  it('COMPLETED → every capability false even with full admin permissions', () => {
    const caps = computeExecutionControlCapabilities('COMPLETED', ADMIN_PERMISSIONS);
    expect(caps).toEqual({ canPause: false, canResume: false, canStop: false, canRestart: false });
  });

  it('FAILED and REJECTED → every capability false', () => {
    expect(computeExecutionControlCapabilities('FAILED', ADMIN_PERMISSIONS)).toEqual({
      canPause: false,
      canResume: false,
      canStop: false,
      canRestart: false,
    });
    expect(computeExecutionControlCapabilities('REJECTED', ADMIN_PERMISSIONS)).toEqual({
      canPause: false,
      canResume: false,
      canStop: false,
      canRestart: false,
    });
  });

  it('EXECUTIVE (no admin permission keys at all) → every capability false regardless of status', () => {
    for (const status of ['ACCEPTED', 'RUNNING', 'PAUSED', 'STOPPED'] as const) {
      expect(computeExecutionControlCapabilities(status, [])).toEqual({
        canPause: false,
        canResume: false,
        canStop: false,
        canRestart: false,
      });
    }
  });

  it('DRAFT/VALIDATING/SUBMITTING/SUBMISSION_UNKNOWN → every capability false even for a full admin', () => {
    for (const status of ['DRAFT', 'VALIDATING', 'SUBMITTING', 'SUBMISSION_UNKNOWN'] as const) {
      expect(computeExecutionControlCapabilities(status, ADMIN_PERMISSIONS).canStop).toBe(false);
    }
  });
});
