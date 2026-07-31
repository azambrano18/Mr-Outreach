import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProcessMotorEventUseCase } from '../../application/motor-event/process-motor-event.use-case';
import { MotorEventEnvelopeDto } from './dto/motor-event-envelope.dto';
import { MotorEventAuthGuard } from './guards/motor-event-auth.guard';

/**
 * Fase "Recepción de eventos del motor" — the motor's inbound entry point.
 * Deliberately NOT under JwtAuthGuard/PermissionsGuard: the caller is an
 * external system authenticated by HMAC signature (MotorEventAuthGuard),
 * never a logged-in user. Never exposed through the frontend — no
 * apps/web proxy route is created for this.
 */
@ApiTags('motor-events')
@Controller('integration/events')
@UseGuards(MotorEventAuthGuard)
export class MotorEventsController {
  constructor(private readonly processEvent: ProcessMotorEventUseCase) {}

  @Post()
  @HttpCode(200)
  async receive(@Body() envelope: MotorEventEnvelopeDto): Promise<{ eventId: string; outcome: string; errors?: string[] }> {
    const result = await this.processEvent.execute({ envelope, origin: 'REMOTE' });
    if (result.outcome === 'INVALID_PAYLOAD') {
      throw new BadRequestException({ eventId: result.eventId, outcome: result.outcome, errors: result.errors });
    }
    // Every other outcome (PROCESSED/ALREADY_PROCESSED/ALREADY_PROCESSING/
    // FAILED_RETRYABLE/FAILED_TERMINAL) returns 200 — the event was
    // durably received either way; FAILED_* means the projection itself
    // failed and was recorded for a human/admin retry, never "please
    // resend", since resending just replays the same eventId idempotently.
    return { eventId: result.eventId, outcome: result.outcome, ...(result.errors ? { errors: result.errors } : {}) };
  }
}
