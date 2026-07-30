import { BadRequestException, ConflictException, GoneException, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { HttpMailboxMotorAdapter } from './http-mailbox-motor-adapter';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('HttpMailboxMotorAdapter', () => {
  let config: jest.Mocked<Pick<AppConfigService, 'mailboxMotorBaseUrl' | 'mailboxMotorApiKey' | 'mailboxMotorTimeoutMs'>>;
  let adapter: HttpMailboxMotorAdapter;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    config = {
      mailboxMotorBaseUrl: 'https://motor.internal',
      mailboxMotorApiKey: 'test-api-key',
      mailboxMotorTimeoutMs: 5000,
    };
    adapter = new HttpMailboxMotorAdapter(config as unknown as AppConfigService);
    fetchMock = jest.fn();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const wireMailbox = { serverMailboxId: 'mbx_1', email: 'ventas@cliente.cl', displayName: 'Ventas', status: 'CONNECTED', canSend: true };
  const wireDomain = { serverDomainId: 'dom_1', name: 'cliente.cl' };
  const wireClient = { serverClientId: 'client_1', name: 'Cliente' };

  it('introspects a token, sending Bearer auth and never the token as a header', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        valid: true,
        tokenId: 'tok_1',
        status: 'ISSUED',
        expiresAt: '2026-07-25T15:00:00Z',
        mailbox: wireMailbox,
        domain: wireDomain,
        client: wireClient,
      }),
    );

    const result = await adapter.introspectLinkToken('mot_lnk_xxx');

    expect(result.valid).toBe(true);
    expect(result.mailbox.serverMailboxId).toBe('mbx_1');
    expect(result.expiresAt).toBeInstanceOf(Date);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://motor.internal/v1/mailbox-link-tokens/introspect');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-api-key');
    expect(JSON.stringify(init.body)).not.toContain('Authorization');
  });

  it('maps 400 to BadRequestException for a malformed/unrecognized token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: 'bad token' }));
    await expect(adapter.introspectLinkToken('bad')).rejects.toThrow(BadRequestException);
  });

  it('maps a network/timeout failure to ServiceUnavailableException, never logging the raw error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED at motor.internal:443 with secret query param'));
    await expect(adapter.introspectLinkToken('tok')).rejects.toThrow(ServiceUnavailableException);
  });

  it('maps a non-JSON success body to ServiceUnavailableException ("respuesta inválida")', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('invalid json');
      },
    } as unknown as Response);
    await expect(adapter.introspectLinkToken('tok')).rejects.toThrow(ServiceUnavailableException);
  });

  it('redeems a token, sending Idempotency-Key and X-Correlation-Id headers', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        redemptionId: 'red_1',
        tokenId: 'tok_1',
        status: 'REDEEMED',
        redeemedAt: '2026-07-24T18:30:00Z',
        mailbox: wireMailbox,
        domain: wireDomain,
        client: wireClient,
      }),
    );

    const result = await adapter.redeemLinkToken({
      token: 'mot_lnk_xxx',
      idempotencyKey: 'idem-1',
      requestingOrganizationId: 'org_1',
      actorId: 'admin_1',
    });

    expect(result.redemptionId).toBe('red_1');
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('idem-1');
    expect(headers['X-Correlation-Id']).toEqual(expect.any(String));
  });

  it('maps 409 to ConflictException (token already redeemed by another organization)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, {}));
    await expect(
      adapter.redeemLinkToken({ token: 't', idempotencyKey: 'k', requestingOrganizationId: 'org_1', actorId: 'a' }),
    ).rejects.toThrow(ConflictException);
  });

  it('maps 410 to GoneException (token expired/revoked)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(410, {}));
    await expect(
      adapter.redeemLinkToken({ token: 't', idempotencyKey: 'k', requestingOrganizationId: 'org_1', actorId: 'a' }),
    ).rejects.toThrow(GoneException);
  });

  it('fails closed (503) on any other non-2xx status', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expect(adapter.getMailboxStatus('mbx_1')).rejects.toThrow(ServiceUnavailableException);
  });

  it('queries mailbox status via GET with no body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        serverMailboxId: 'mbx_1',
        linkStatus: 'ACTIVE',
        technicalStatus: 'CONNECTED',
        canSend: true,
        checkedAt: '2026-07-24T18:40:00Z',
      }),
    );

    const result = await adapter.getMailboxStatus('mbx_1');

    expect(result.technicalStatus).toBe('CONNECTED');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://motor.internal/v1/mailboxes/mbx_1/status');
    expect(init.method).toBe('GET');
  });

  it('requests unlink with Idempotency-Key and returns the revocation receipt', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { serverMailboxId: 'mbx_1', status: 'REVOKED', revocationId: 'rev_1', revokedAt: '2026-07-24T16:00:00Z' }),
    );

    const result = await adapter.unlinkMailbox({
      serverMailboxId: 'mbx_1',
      idempotencyKey: 'idem-2',
      requestingOrganizationId: 'org_1',
      actorId: 'admin_1',
      reason: 'baja',
      correlationId: 'corr_1',
    });

    expect(result.revocationId).toBe('rev_1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://motor.internal/v1/mailboxes/mbx_1/unlink');
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('idem-2');
    expect(headers['X-Correlation-Id']).toBe('corr_1');
  });
});
