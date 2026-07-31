import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  MotorEventAuthenticator,
  MotorEventAuthInput,
  MotorEventAuthResult,
} from '../../../domain/motor-event/motor-event-authenticator';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Signature scheme: hex(HMAC-SHA256(secret, `${timestampHeader}.${rawBody}`)).
 * Same shape as Stripe/GitHub webhook signing — well-understood, no reason
 * to invent a bespoke one. `timestampHeader` is Unix seconds, mixed into the
 * signed material itself so a captured (signature, body) pair can't be
 * replayed with a forged, still-fresh timestamp — the timestamp used for
 * the tolerance check is the SAME one that was signed.
 *
 * Fail-closed by construction: `isConfigured()` returns false whenever
 * MOTOR_EVENT_HMAC_SECRET is empty, in every environment (never just
 * production) — MotorEventAuthGuard 404s the entire endpoint in that case
 * rather than falling back to an authenticator that accepts everything.
 */
@Injectable()
export class HmacMotorEventAuthenticator implements MotorEventAuthenticator {
  constructor(private readonly config: AppConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.motorEventHmacSecret);
  }

  verify(input: MotorEventAuthInput): MotorEventAuthResult {
    const secret = this.config.motorEventHmacSecret;
    if (!secret) {
      return { authenticated: false, failureReason: 'NOT_CONFIGURED' };
    }
    if (!input.signatureHeader) {
      return { authenticated: false, failureReason: 'MISSING_SIGNATURE' };
    }
    if (!input.timestampHeader) {
      return { authenticated: false, failureReason: 'MISSING_TIMESTAMP' };
    }

    const timestampSeconds = Number(input.timestampHeader);
    if (!Number.isFinite(timestampSeconds)) {
      return { authenticated: false, failureReason: 'INVALID_TIMESTAMP' };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const skew = Math.abs(nowSeconds - timestampSeconds);
    if (skew > this.config.motorEventMaxClockSkewSeconds) {
      return { authenticated: false, failureReason: 'TIMESTAMP_OUT_OF_TOLERANCE' };
    }

    const expectedSignature = createHmac('sha256', secret)
      .update(`${input.timestampHeader}.${input.rawBody}`)
      .digest('hex');

    if (!this.safeCompare(expectedSignature, input.signatureHeader)) {
      return { authenticated: false, failureReason: 'INVALID_SIGNATURE' };
    }

    return { authenticated: true };
  }

  /** Constant-time comparison — a naive `===` would leak timing information about how many leading bytes matched. */
  private safeCompare(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(actual, 'utf8');
    if (expectedBuffer.length !== actualBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }
}
