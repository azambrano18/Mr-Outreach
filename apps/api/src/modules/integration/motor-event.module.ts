import { Module } from '@nestjs/common';
import { MotorEventProjector } from '../../application/motor-event/motor-event-projector.service';
import { ProcessMotorEventUseCase } from '../../application/motor-event/process-motor-event.use-case';
import { RetryMotorEventUseCase } from '../../application/motor-event/retry-motor-event.use-case';
import { MOTOR_EVENT_AUTHENTICATOR } from '../../domain/motor-event/motor-event-authenticator';
import { HmacMotorEventAuthenticator } from '../../infrastructure/motor-event/hmac/hmac-motor-event-authenticator';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { MotorEventAuthGuard } from './guards/motor-event-auth.guard';
import { MotorEventsController } from './motor-events.controller';

/**
 * Fase "Recepción de eventos del motor" — owns the authenticated inbound
 * event receiver (`POST /integration/events`) and its projection/retry
 * machinery. Deliberately separate from IntegrationModule (the legacy
 * simulated-flow Outbox/Inbox mechanics) even though both ultimately write
 * to the same `integration_events` table — this module's controller has no
 * JWT guard at all, so keeping it isolated makes that fact easy to audit at
 * a glance rather than buried inside a module that's otherwise all
 * JWT-protected routes.
 */
@Module({
  imports: [PersistenceModule],
  controllers: [MotorEventsController],
  providers: [
    MotorEventProjector,
    ProcessMotorEventUseCase,
    RetryMotorEventUseCase,
    MotorEventAuthGuard,
    { provide: MOTOR_EVENT_AUTHENTICATOR, useClass: HmacMotorEventAuthenticator },
  ],
  exports: [ProcessMotorEventUseCase, RetryMotorEventUseCase],
})
export class MotorEventModule {}
