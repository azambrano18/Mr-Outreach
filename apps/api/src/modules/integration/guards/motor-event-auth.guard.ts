import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import {
  MOTOR_EVENT_AUTHENTICATOR,
  MotorEventAuthenticator,
} from '../../../domain/motor-event/motor-event-authenticator';

/**
 * Guards `POST /integration/events`. Deliberately NOT `JwtAuthGuard` — the
 * caller is the external motor (or, in development/test, the dev-only
 * simulator's own signed synthetic request), never a logged-in user.
 *
 * Fail-closed in every environment, not just production: if the
 * authenticator reports it isn't configured (no HMAC secret set), this
 * guard 404s — the route's existence never leaks, and no event is ever
 * accepted "for now" while security configuration is incomplete.
 */
@Injectable()
export class MotorEventAuthGuard implements CanActivate {
  constructor(
    @Inject(MOTOR_EVENT_AUTHENTICATOR) private readonly authenticator: MotorEventAuthenticator,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.authenticator.isConfigured()) {
      throw new NotFoundException();
    }

    const request = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const rawBody = request.rawBody ? request.rawBody.toString('utf8') : '';
    const signatureHeader = firstHeaderValue(request.headers['x-motor-signature']);
    const timestampHeader = firstHeaderValue(request.headers['x-motor-timestamp']);

    const result = this.authenticator.verify({ rawBody, signatureHeader, timestampHeader });
    if (!result.authenticated) {
      // Never echo failureReason to the caller — logged server-side only by whoever calls this guard's result, never in the HTTP response body.
      throw new UnauthorizedException('Firma o timestamp inválidos.');
    }
    return true;
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
