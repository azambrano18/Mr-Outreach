import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { StartSequenceExecutionInput } from '../../../domain/sequence-execution-motor/sequence-execution-motor.types';
import { HttpSequenceExecutionMotorAdapter } from './http-sequence-execution-motor-adapter';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('HttpSequenceExecutionMotorAdapter', () => {
  let config: jest.Mocked<Pick<AppConfigService, 'sequenceMotorBaseUrl' | 'sequenceMotorApiKey' | 'sequenceMotorTimeoutMs'>>;
  let adapter: HttpSequenceExecutionMotorAdapter;
  let fetchMock: jest.Mock;

  const startInput: StartSequenceExecutionInput = {
    idempotencyKey: 'idem-exec-1',
    correlationId: 'corr-exec-1',
    localExecutionId: 'run_local_1',
    serverTemplateId: 'tplv_server_002',
    prospects: [
      { localProspectId: 'row_1', email: 'persona1@empresa.cl', variables: { contact_name: 'Ana' } },
      { localProspectId: 'row_2', email: 'persona2@empresa.cl', variables: { contact_name: 'Pedro' } },
    ],
  };

  beforeEach(() => {
    config = {
      sequenceMotorBaseUrl: 'https://sequence-motor.internal',
      sequenceMotorApiKey: 'super-secret-key',
      sequenceMotorTimeoutMs: 5000,
    };
    adapter = new HttpSequenceExecutionMotorAdapter(config as unknown as AppConfigService);
    fetchMock = jest.fn();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts an execution with the minimal contract: URL, method, headers, and a payload carrying ONLY serverTemplateId/localExecutionId/prospects/commandId/idempotencyKey/correlationId', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        accepted: true,
        serverExecutionId: 'exec_srv_1',
        executionToken: 'ext_xxx',
        status: 'ACCEPTED',
        receivedProspects: 2,
        acceptedProspects: 2,
        rejectedProspects: 0,
        initialProspectState: 'STEP_01_PENDING',
        receivedAt: '2026-07-29T15:00:00Z',
      }),
    );

    const result = await adapter.startExecution(startInput);

    expect(result.accepted).toBe(true);
    expect(result.serverExecutionId).toBe('exec_srv_1');
    expect(result.initialProspectState).toBe('STEP_01_PENDING');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sequence-motor.internal/v1/sequence-executions/start');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer super-secret-key');
    expect(headers['Idempotency-Key']).toBe('idem-exec-1');
    expect(headers['X-Correlation-Id']).toBe('corr-exec-1');

    const body = JSON.parse(init.body as string);
    expect(body.commandId).toEqual(expect.any(String));
    expect(body.idempotencyKey).toBe('idem-exec-1');
    expect(body.correlationId).toBe('corr-exec-1');
    expect(body.template).toEqual({ serverTemplateId: 'tplv_server_002' });
    expect(body.execution).toEqual({ localExecutionId: 'run_local_1' });
    expect(body.prospects).toEqual([
      { localProspectId: 'row_1', email: 'persona1@empresa.cl', variables: { contact_name: 'Ana' } },
      { localProspectId: 'row_2', email: 'persona2@empresa.cl', variables: { contact_name: 'Pedro' } },
    ]);
    // §6 — never a queue, priority, technical owner, scheduled date/time, initialStep, serverMailboxId or templateToken.
    const bodyKeys = Object.keys(body);
    expect(bodyKeys).toEqual(['schemaVersion', 'commandType', 'commandId', 'idempotencyKey', 'correlationId', 'template', 'execution', 'prospects']);
    expect(JSON.stringify(body)).not.toMatch(/queue|priority|technicalOwner|scheduledDate|scheduledTime|initialStep|serverMailboxId|templateToken/i);
  });

  it('surfaces a business rejection as {accepted:false} rather than throwing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        accepted: false,
        serverExecutionId: null,
        status: 'REJECTED',
        receivedProspects: 0,
        acceptedProspects: 0,
        rejectedProspects: 0,
        receivedAt: null,
        rejectionReason: 'Cuenta no disponible.',
      }),
    );
    const result = await adapter.startExecution(startInput);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('Cuenta no disponible.');
  });

  it('maps a network failure/timeout to ServiceUnavailableException without logging the API key or base URL', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(new Error('aborted'));
    await expect(adapter.startExecution(startInput)).rejects.toThrow(ServiceUnavailableException);
    const loggedMessages = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(loggedMessages.some((msg) => msg.includes('super-secret-key'))).toBe(false);
    expect(loggedMessages.some((msg) => msg.includes('https://sequence-motor.internal'))).toBe(false);
  });

  it('maps a malformed (non-JSON) success response to ServiceUnavailableException', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('invalid json');
      },
    } as unknown as Response);
    await expect(adapter.startExecution(startInput)).rejects.toThrow(ServiceUnavailableException);
  });

  it('maps a non-2xx HTTP status to ServiceUnavailableException (fail-closed)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expect(adapter.startExecution(startInput)).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailableException immediately when SEQUENCE_MOTOR_BASE_URL is not configured', async () => {
    (config as any).sequenceMotorBaseUrl = undefined;
    await expect(adapter.startExecution(startInput)).rejects.toThrow(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('queries execution status via GET with no body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        serverExecutionId: 'exec_srv_1',
        status: 'RUNNING',
        currentStepNumber: 1,
        sentCount: 1,
        pendingCount: 1,
        failedCount: 0,
        lastError: null,
        checkedAt: '2026-07-29T15:30:00Z',
      }),
    );
    const result = await adapter.getExecutionStatus('exec_srv_1');
    expect(result.status).toBe('RUNNING');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sequence-motor.internal/v1/sequence-executions/exec_srv_1/status');
    expect(init.method).toBe('GET');
  });
});
