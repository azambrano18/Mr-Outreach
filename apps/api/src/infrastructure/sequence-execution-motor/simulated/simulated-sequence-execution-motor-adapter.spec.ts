import { ServiceUnavailableException } from '@nestjs/common';
import { StartSequenceExecutionInput } from '../../../domain/sequence-execution-motor/sequence-execution-motor.types';
import { SimulatedSequenceExecutionMotorAdapter } from './simulated-sequence-execution-motor-adapter';

function baseInput(overrides: Partial<StartSequenceExecutionInput> = {}): StartSequenceExecutionInput {
  return {
    idempotencyKey: 'idem_1',
    correlationId: 'corr_1',
    localExecutionId: 'run_1',
    serverTemplateId: 'tpl_server_1',
    prospects: [{ localProspectId: 'row_1', email: 'persona@empresa.cl', variables: {} }],
    ...overrides,
  };
}

describe('SimulatedSequenceExecutionMotorAdapter — §13 contrato simplificado', () => {
  let adapter: SimulatedSequenceExecutionMotorAdapter;

  beforeEach(() => {
    adapter = new SimulatedSequenceExecutionMotorAdapter();
  });

  it('receives only serverTemplateId + normalized prospects — no mailbox/token/date fields exist on the input type', async () => {
    const input = baseInput();
    expect(Object.keys(input).sort()).toEqual(['correlationId', 'idempotencyKey', 'localExecutionId', 'prospects', 'serverTemplateId']);
    const result = await adapter.startExecution(input);
    expect(result.accepted).toBe(true);
  });

  it('scenario: accepted — assigns STEP_01_PENDING to every prospect by default (the server\'s own initiative)', async () => {
    const result = await adapter.startExecution(baseInput());
    expect(result.accepted).toBe(true);
    expect(result.status).toBe('ACCEPTED');
    expect(result.initialProspectState).toBe('STEP_01_PENDING');
    expect(result.receivedAt).toBeInstanceOf(Date);
    expect(result.serverExecutionId).toMatch(/^exec_/);
  });

  it('scenario: accepted, simulating a server response that omits initialProspectState entirely', async () => {
    adapter.setNextInitialProspectState(null);
    const result = await adapter.startExecution(baseInput());
    expect(result.accepted).toBe(true);
    expect(result.initialProspectState).toBeNull();
  });

  it('scenario: rejected — revoked account', async () => {
    adapter.setNextStartOutcome('REJECTED', 'La cuenta fue revocada.');
    const result = await adapter.startExecution(baseInput());
    expect(result.accepted).toBe(false);
    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReason).toBe('La cuenta fue revocada.');
    expect(result.serverExecutionId).toBeNull();
  });

  it('scenario: rejected — account without sending capacity', async () => {
    adapter.setNextStartOutcome('REJECTED', 'La cuenta no tiene capacidad de envío disponible.');
    const result = await adapter.startExecution(baseInput());
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('La cuenta no tiene capacidad de envío disponible.');
  });

  it('scenario: motor unavailable (timeout) — throws instead of returning a business result', async () => {
    adapter.setMotorUnavailable(true);
    await expect(adapter.startExecution(baseInput())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('scenario: timeout followed by a later successful retry with the same idempotencyKey never creates a second remote Gestión', async () => {
    adapter.setMotorUnavailable(true);
    await expect(adapter.startExecution(baseInput({ idempotencyKey: 'retry_key' }))).rejects.toBeInstanceOf(ServiceUnavailableException);

    adapter.setMotorUnavailable(false);
    const result = await adapter.startExecution(baseInput({ idempotencyKey: 'retry_key' }));
    expect(result.accepted).toBe(true);

    const secondCallSameKey = await adapter.startExecution(baseInput({ idempotencyKey: 'retry_key' }));
    expect(secondCallSameKey).toBe(result);
    expect(secondCallSameKey.serverExecutionId).toBe(result.serverExecutionId);
  });

  it('scenario: duplicate command with the same idempotency key returns the identical cached result', async () => {
    const first = await adapter.startExecution(baseInput({ idempotencyKey: 'dup_key' }));
    const second = await adapter.startExecution(baseInput({ idempotencyKey: 'dup_key', prospects: [] }));
    expect(second).toBe(first);
  });

  it('advances an accepted execution to RUNNING, as the server itself would once it dequeues it internally', async () => {
    const result = await adapter.startExecution(baseInput());
    const initialSnapshot = await adapter.getExecutionStatus(result.serverExecutionId!);
    expect(initialSnapshot.status).toBe('QUEUED');
    expect(initialSnapshot.startedAt).toBeNull();

    adapter.advanceToRunning(result.serverExecutionId!);
    const runningSnapshot = await adapter.getExecutionStatus(result.serverExecutionId!);
    expect(runningSnapshot.status).toBe('RUNNING');
    expect(runningSnapshot.startedAt).toBeInstanceOf(Date);
  });

  describe('Fase "Control operativo de Gestiones" — pause/resume/stop', () => {
    async function startedExecution(): Promise<string> {
      const result = await adapter.startExecution(baseInput());
      return result.serverExecutionId!;
    }

    it('a freshly started execution can dispatch new emails', async () => {
      const serverExecutionId = await startedExecution();
      expect(adapter.canDispatchNewEmail(serverExecutionId)).toBe(true);
    });

    it('pause blocks new dispatch immediately (real, observable effect — not merely a label)', async () => {
      const serverExecutionId = await startedExecution();
      const result = await adapter.pauseExecution({ idempotencyKey: 'p1', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId });
      expect(result.accepted).toBe(true);
      expect(adapter.canDispatchNewEmail(serverExecutionId)).toBe(false);
    });

    it('an in-flight send already handed to the motor before the pause still completes', async () => {
      const serverExecutionId = await startedExecution();
      await adapter.pauseExecution({ idempotencyKey: 'p2', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId });
      expect(adapter.deliverInFlightSend(serverExecutionId)).toBe(1);
      expect(adapter.getDeliveredCount(serverExecutionId)).toBe(1);
    });

    it('resume restores dispatch after a pause', async () => {
      const serverExecutionId = await startedExecution();
      await adapter.pauseExecution({ idempotencyKey: 'p3', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId });
      expect(adapter.canDispatchNewEmail(serverExecutionId)).toBe(false);

      const result = await adapter.resumeExecution({ idempotencyKey: 'r1', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId });
      expect(result.accepted).toBe(true);
      expect(adapter.canDispatchNewEmail(serverExecutionId)).toBe(true);
    });

    it('resume on a non-PAUSED execution (already ACTIVE) is a harmless no-op — apply() only transitions from PAUSED', async () => {
      const serverExecutionId = await startedExecution();
      const result = await adapter.resumeExecution({ idempotencyKey: 'r2', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId });
      expect(result.accepted).toBe(true);
      expect(adapter.canDispatchNewEmail(serverExecutionId)).toBe(true);
    });

    it('stop blocks new dispatch and is never reversible via resume — resume after stop leaves dispatch blocked', async () => {
      const serverExecutionId = await startedExecution();
      const stopResult = await adapter.stopExecution({ idempotencyKey: 's1', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId });
      expect(stopResult.accepted).toBe(true);
      expect(adapter.canDispatchNewEmail(serverExecutionId)).toBe(false);

      await adapter.resumeExecution({ idempotencyKey: 'r3', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId });
      expect(adapter.canDispatchNewEmail(serverExecutionId)).toBe(false);
    });

    it('stop differs from pause: stop is permanent (never returns to ACTIVE), pause is reversible', async () => {
      const pausedResult = await adapter.startExecution(baseInput({ idempotencyKey: 'diff_start_paused' }));
      const stoppedResult = await adapter.startExecution(baseInput({ idempotencyKey: 'diff_start_stopped' }));
      const paused = pausedResult.serverExecutionId!;
      const stopped = stoppedResult.serverExecutionId!;
      await adapter.pauseExecution({ idempotencyKey: 'diff_p', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId: paused });
      await adapter.stopExecution({ idempotencyKey: 'diff_s', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId: stopped });

      await adapter.resumeExecution({ idempotencyKey: 'diff_p_resume', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId: paused });
      await adapter.resumeExecution({ idempotencyKey: 'diff_s_resume', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId: stopped });

      expect(adapter.canDispatchNewEmail(paused)).toBe(true);
      expect(adapter.canDispatchNewEmail(stopped)).toBe(false);
    });

    it('a retried pause with the same idempotencyKey (double click) never re-applies — returns the identical cached result', async () => {
      const serverExecutionId = await startedExecution();
      const first = await adapter.pauseExecution({ idempotencyKey: 'dup_pause', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId });
      const second = await adapter.pauseExecution({ idempotencyKey: 'dup_pause', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId });
      expect(second).toBe(first);
    });

    it('scenario: the motor rejects a control command — execution keeps dispatching', async () => {
      const serverExecutionId = await startedExecution();
      adapter.setNextControlOutcome('REJECTED', 'La ejecución ya está en un estado terminal.');
      const result = await adapter.pauseExecution({ idempotencyKey: 'rej_1', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId });
      expect(result.accepted).toBe(false);
      expect(result.rejectionReason).toBe('La ejecución ya está en un estado terminal.');
      expect(adapter.canDispatchNewEmail(serverExecutionId)).toBe(true);
    });

    it('a control command against an unknown serverExecutionId is rejected, never throws', async () => {
      const result = await adapter.pauseExecution({ idempotencyKey: 'unknown_1', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId: 'exec_missing' });
      expect(result.accepted).toBe(false);
      expect(result.rejectionReason).toBe('Cuenta de ejecución desconocida para el motor.');
    });

    it('scenario: motor unavailable (timeout) on a control command — throws instead of returning a business result', async () => {
      const serverExecutionId = await startedExecution();
      adapter.setMotorUnavailable(true);
      await expect(
        adapter.pauseExecution({ idempotencyKey: 'timeout_1', correlationId: 'c1', localExecutionId: 'run_1', serverExecutionId }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
