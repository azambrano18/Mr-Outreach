import { Body, Controller, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DevMotorEventEmitterService } from '../../application/motor-event/dev-motor-event-emitter.service';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SimulateMotorEventDto } from './dto/simulate-motor-event.dto';

/**
 * Dev-only tool — Fase 12 ("el simulador debe usar el mismo DTO; usar el
 * mismo caso de uso; usar la misma persistencia"). Builds a real
 * MotorEventEnvelopeDto and runs it through the exact same
 * ProcessMotorEventUseCase the authenticated `POST /integration/events`
 * endpoint uses (via DevMotorEventEmitterService), tagged with
 * origin='SIMULATED' so it lands in the same `origin`-scoped dedup
 * namespace as the rest of this app's existing simulation mode, never
 * mixing with real REMOTE-origin events.
 *
 * Gated exactly like DevSimulatedExecutionsController: 404s (never 403,
 * so the route's existence never leaks) unless BOTH
 * SEQUENCE_MOTOR_MODE=simulated and NODE_ENV!=='production' hold. This is
 * the explicit development/test adapter Fase 4/12 allow — it bypasses
 * MotorEventAuthGuard entirely because it never calls the HTTP endpoint,
 * it calls the use case in-process, so JWT + this permission are the only
 * gate, deliberately never reachable against a real motor connection.
 */
@ApiTags('dev-motor-events')
@Controller('dev/motor-events')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DevMotorEventsController {
  constructor(
    private readonly config: AppConfigService,
    private readonly emitter: DevMotorEventEmitterService,
  ) {}

  private assertToolEnabled(): void {
    if (this.config.sequenceMotorMode !== 'simulated' || this.config.nodeEnv === 'production') {
      throw new NotFoundException();
    }
  }

  @Post(':executionId/emit')
  @RequirePermissions('dev_tools.simulate_motor_events')
  async emit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('executionId') executionId: string,
    @Body() dto: SimulateMotorEventDto,
  ) {
    this.assertToolEnabled();
    return this.emitter.emit(user.organizationId, executionId, dto.eventType, dto.payload);
  }
}
