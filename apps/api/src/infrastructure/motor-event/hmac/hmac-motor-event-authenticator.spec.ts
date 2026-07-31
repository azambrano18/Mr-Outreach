import { createHmac } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';
import { HmacMotorEventAuthenticator } from './hmac-motor-event-authenticator';

describe('HmacMotorEventAuthenticator', () => {
  const secret = 'unit-test-hmac-secret';

  function sign(timestamp: string, rawBody: string, usingSecret = secret): string {
    return createHmac('sha256', usingSecret).update(`${timestamp}.${rawBody}`).digest('hex');
  }

  function buildAuthenticator(overrides: { secret?: string; maxClockSkewSeconds?: number } = {}) {
    const config = {
      motorEventHmacSecret: overrides.secret ?? secret,
      motorEventMaxClockSkewSeconds: overrides.maxClockSkewSeconds ?? 300,
    } as AppConfigService;
    return new HmacMotorEventAuthenticator(config);
  }

  it('isConfigured() is false when MOTOR_EVENT_HMAC_SECRET is empty — fail-closed in every environment', () => {
    const authenticator = buildAuthenticator({ secret: '' });
    expect(authenticator.isConfigured()).toBe(false);
  });

  it('isConfigured() is true when a secret is present', () => {
    const authenticator = buildAuthenticator();
    expect(authenticator.isConfigured()).toBe(true);
  });

  it('accepts a valid signature within the clock-skew tolerance', () => {
    const authenticator = buildAuthenticator();
    const rawBody = JSON.stringify({ eventId: 'evt_1' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(timestamp, rawBody);

    const result = authenticator.verify({ rawBody, signatureHeader: signature, timestampHeader: timestamp });

    expect(result.authenticated).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const authenticator = buildAuthenticator();
    const rawBody = JSON.stringify({ eventId: 'evt_1' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(timestamp, rawBody, 'a-completely-different-secret');

    const result = authenticator.verify({ rawBody, signatureHeader: signature, timestampHeader: timestamp });

    expect(result.authenticated).toBe(false);
    expect(result.failureReason).toBe('INVALID_SIGNATURE');
  });

  it('rejects a signature computed over a different body (tampered payload)', () => {
    const authenticator = buildAuthenticator();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(timestamp, JSON.stringify({ eventId: 'evt_1' }));

    const result = authenticator.verify({
      rawBody: JSON.stringify({ eventId: 'evt_1_TAMPERED' }),
      signatureHeader: signature,
      timestampHeader: timestamp,
    });

    expect(result.authenticated).toBe(false);
    expect(result.failureReason).toBe('INVALID_SIGNATURE');
  });

  it('rejects an expired timestamp beyond the configured tolerance', () => {
    const authenticator = buildAuthenticator({ maxClockSkewSeconds: 300 });
    const rawBody = JSON.stringify({ eventId: 'evt_1' });
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const signature = sign(staleTimestamp, rawBody);

    const result = authenticator.verify({ rawBody, signatureHeader: signature, timestampHeader: staleTimestamp });

    expect(result.authenticated).toBe(false);
    expect(result.failureReason).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
  });

  it('rejects a timestamp too far in the future (replay-with-forged-future-timestamp)', () => {
    const authenticator = buildAuthenticator({ maxClockSkewSeconds: 300 });
    const rawBody = JSON.stringify({ eventId: 'evt_1' });
    const futureTimestamp = String(Math.floor(Date.now() / 1000) + 3600);
    const signature = sign(futureTimestamp, rawBody);

    const result = authenticator.verify({ rawBody, signatureHeader: signature, timestampHeader: futureTimestamp });

    expect(result.authenticated).toBe(false);
    expect(result.failureReason).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
  });

  it('rejects a non-numeric timestamp header', () => {
    const authenticator = buildAuthenticator();
    const result = authenticator.verify({
      rawBody: '{}',
      signatureHeader: 'deadbeef',
      timestampHeader: 'not-a-number',
    });

    expect(result.authenticated).toBe(false);
    expect(result.failureReason).toBe('INVALID_TIMESTAMP');
  });

  it('rejects a missing signature header', () => {
    const authenticator = buildAuthenticator();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = authenticator.verify({ rawBody: '{}', signatureHeader: null, timestampHeader: timestamp });

    expect(result.authenticated).toBe(false);
    expect(result.failureReason).toBe('MISSING_SIGNATURE');
  });

  it('rejects a missing timestamp header', () => {
    const authenticator = buildAuthenticator();
    const result = authenticator.verify({ rawBody: '{}', signatureHeader: 'deadbeef', timestampHeader: null });

    expect(result.authenticated).toBe(false);
    expect(result.failureReason).toBe('MISSING_TIMESTAMP');
  });

  it('reports NOT_CONFIGURED when verify() is called despite an empty secret', () => {
    const authenticator = buildAuthenticator({ secret: '' });
    const result = authenticator.verify({ rawBody: '{}', signatureHeader: 'deadbeef', timestampHeader: '123' });

    expect(result.authenticated).toBe(false);
    expect(result.failureReason).toBe('NOT_CONFIGURED');
  });
});
