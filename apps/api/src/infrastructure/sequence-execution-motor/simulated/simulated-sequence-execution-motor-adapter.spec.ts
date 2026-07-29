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
});
