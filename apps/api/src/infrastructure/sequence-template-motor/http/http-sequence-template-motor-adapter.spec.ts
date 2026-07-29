import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { PublishSequenceTemplateInput } from '../../../domain/sequence-template-motor/sequence-template-motor.types';
import { HttpSequenceTemplateMotorAdapter } from './http-sequence-template-motor-adapter';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('HttpSequenceTemplateMotorAdapter', () => {
  let config: jest.Mocked<Pick<AppConfigService, 'sequenceMotorBaseUrl' | 'sequenceMotorApiKey' | 'sequenceMotorTimeoutMs'>>;
  let adapter: HttpSequenceTemplateMotorAdapter;
  let fetchMock: jest.Mock;

  const firstPublishInput: PublishSequenceTemplateInput = {
    idempotencyKey: 'idem-1',
    correlationId: 'corr-1',
    organizationId: 'org_1',
    executiveUserId: 'exec_1',
    localTemplateId: 'tpl_local_1',
    previousServerTemplateId: null,
    serverMailboxId: 'mbx_server_001',
    mailboxEmail: 'ventas@empresa.cl',
    name: 'Prospección Gerentes de RR. HH.',
    version: 1,
    timezone: 'America/Santiago',
    subjectTemplate: 'Hola {contact_name}',
    signatureHtml: '<div>Firma</div>',
    variables: [{ key: 'contact_name', required: false }],
    steps: [
      {
        stepNumber: 1,
        headerText: null,
        bodyHtml: '<p>Envío 1</p>',
        bodyText: 'Envío 1',
        schedule: {
          delayValue: 0,
          delayUnit: 'BUSINESS_DAYS',
          delayReference: 'EXECUTION_START',
          allowedWeekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
          sendWindowStart: '00:00',
          sendWindowEnd: '19:00',
        },
      },
      {
        stepNumber: 2,
        headerText: null,
        bodyHtml: '<p>Envío 2</p>',
        bodyText: 'Envío 2',
        schedule: {
          delayValue: 5,
          delayUnit: 'BUSINESS_DAYS',
          delayReference: 'PREVIOUS_STEP',
          allowedWeekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
          sendWindowStart: '08:00',
          sendWindowEnd: '19:00',
        },
      },
    ],
  };

  beforeEach(() => {
    config = {
      sequenceMotorBaseUrl: 'https://sequence-motor.internal',
      sequenceMotorApiKey: 'super-secret-key',
      sequenceMotorTimeoutMs: 5000,
    };
    adapter = new HttpSequenceTemplateMotorAdapter(config as unknown as AppConfigService);
    fetchMock = jest.fn();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishes with the correct URL, method, headers (Authorization/Idempotency-Key/X-Correlation-Id) and TEMPLATE_VERSION_PUBLISH payload', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        accepted: true,
        serverTemplateId: 'tplv_server_001',
        templateToken: 'tpt_xxx',
        version: 1,
        status: 'ACCEPTED',
        acceptedAt: '2026-07-29T15:00:00Z',
      }),
    );

    const result = await adapter.publishTemplate(firstPublishInput);

    expect(result.accepted).toBe(true);
    expect(result.serverTemplateId).toBe('tplv_server_001');
    expect(result.acceptedAt).toBeInstanceOf(Date);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sequence-motor.internal/v1/sequence-templates/publish');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer super-secret-key');
    expect(headers['Idempotency-Key']).toBe('idem-1');
    expect(headers['X-Correlation-Id']).toBe('corr-1');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.commandType).toBe('TEMPLATE_VERSION_PUBLISH');
    expect(body.idempotencyKey).toBe('idem-1');
    expect(body.correlationId).toBe('corr-1');
    expect(body.template.localTemplateId).toBe('tpl_local_1');
    expect(body.template.previousServerTemplateId).toBeNull();
    expect(body.template.version).toBe(1);
    expect(body.template.serverMailboxId).toBe('mbx_server_001');
    // Envío 1 carries the special "runs until 19:00" schedule marker, never a delayValue/delayUnit pair.
    expect(body.template.sends[0].schedule).toEqual({
      type: 'EXECUTION_START_UNTIL_19',
      allowedWeekdays: firstPublishInput.steps[0].schedule.allowedWeekdays,
      sendWindowEnd: '19:00',
    });
    // Envíos 2/3 carry delayValue/delayUnit=BUSINESS_DAYS explicitly, no "type" field.
    expect(body.template.sends[1].schedule).toEqual({
      delayValue: 5,
      delayUnit: 'BUSINESS_DAYS',
      allowedWeekdays: firstPublishInput.steps[1].schedule.allowedWeekdays,
      sendWindowStart: '08:00',
      sendWindowEnd: '19:00',
    });
  });

  it('sends previousServerTemplateId when publishing a new version of an already-published template', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        accepted: true,
        serverTemplateId: 'tplv_server_002',
        templateToken: 'tpt_yyy',
        version: 2,
        status: 'ACCEPTED',
        acceptedAt: '2026-07-29T15:10:00Z',
      }),
    );

    const result = await adapter.publishTemplate({ ...firstPublishInput, previousServerTemplateId: 'tplv_server_001', version: 2 });

    expect(result.serverTemplateId).toBe('tplv_server_002');
    expect(result.serverTemplateId).not.toBe('tplv_server_001');
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.template.previousServerTemplateId).toBe('tplv_server_001');
    expect(body.commandType).toBe('TEMPLATE_VERSION_PUBLISH'); // same command as first publish, never a separate "update" type
  });

  it('surfaces a business rejection as {accepted:false, status:FAILED} rather than throwing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        accepted: false,
        serverTemplateId: null,
        templateToken: null,
        version: 1,
        status: 'FAILED',
        acceptedAt: null,
        rejectionReason: 'Contenido inválido.',
      }),
    );
    const result = await adapter.publishTemplate(firstPublishInput);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('Contenido inválido.');
  });

  it('maps a network failure/timeout to ServiceUnavailableException without logging the API key or base URL', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(new Error('aborted'));
    await expect(adapter.publishTemplate(firstPublishInput)).rejects.toThrow(ServiceUnavailableException);
    expect(warnSpy).toHaveBeenCalled();
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
    await expect(adapter.publishTemplate(firstPublishInput)).rejects.toThrow(ServiceUnavailableException);
  });

  it('maps a non-2xx HTTP status to ServiceUnavailableException (fail-closed)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expect(adapter.publishTemplate(firstPublishInput)).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailableException immediately when SEQUENCE_MOTOR_BASE_URL is not configured', async () => {
    (config as any).sequenceMotorBaseUrl = undefined;
    await expect(adapter.publishTemplate(firstPublishInput)).rejects.toThrow(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('queries template status via GET with no body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { serverTemplateId: 'tplv_server_001', status: 'ACCEPTED', checkedAt: '2026-07-29T15:20:00Z' }));
    const result = await adapter.getTemplateStatus('tplv_server_001');
    expect(result.status).toBe('ACCEPTED');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sequence-motor.internal/v1/sequence-templates/tplv_server_001/status');
    expect(init.method).toBe('GET');
  });
});
