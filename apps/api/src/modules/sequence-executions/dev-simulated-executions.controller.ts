import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { DevSimulatedExecutionStateService } from '../../application/sequence-executions/dev-simulated-execution-state.service';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SimulateExecutionStateDto } from './dto/simulate-execution-state.dto';

/**
 * Dev-only tool — lets a local/demo environment force an existing Gestión
 * into any terminal or in-flight state (ACCEPTED/QUEUED/RUNNING/COMPLETED/
 * FAILED/REJECTED) without a real Railway round-trip, so the
 * Borradores/En ejecución/Finalizadas/Con problemas tabs can be validated
 * visually before the real motor is connected.
 *
 * Exists ONLY when BOTH hold:
 *  - `SEQUENCE_MOTOR_MODE=simulated` (AppConfigService#sequenceMotorMode) —
 *    the same switch that already selects SimulatedSequenceExecutionMotorAdapter
 *    over HttpSequenceExecutionMotorAdapter in SequenceExecutionMotorModule;
 *    when the app is wired to the real Railway motor (`=http`) this entire
 *    surface 404s, exactly like DevMailboxTokensController's own gate.
 *  - `NODE_ENV !== 'production'`.
 *
 * A 404 (not 403) is thrown when either condition fails, so the route's
 * very existence never leaks in an environment pointed at the real motor —
 * mirrors the existing `mailboxes/dev/demo-tokens` gate exactly.
 *
 * This never touches `SimulatedSequenceExecutionMotorAdapter`'s own
 * registry, never calls any motor port, and never accepts a token/API key
 * — it only mutates this app's own `SequenceExecution` row directly, the
 * same row the real motor's responses would otherwise update via
 * RefreshExecutionStatusUseCase. No production route, DTO, or contract is
 * changed by this controller's existence.
 */
@ApiTags('dev-simulated-executions')
@Controller('dev/simulated/executions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DevSimulatedExecutionsController {
  constructor(
    private readonly config: AppConfigService,
    private readonly simulation: DevSimulatedExecutionStateService,
  ) {}

  private assertToolEnabled(): void {
    if (this.config.sequenceMotorMode !== 'simulated' || this.config.nodeEnv === 'production') {
      throw new NotFoundException();
    }
  }

  /** Read-only probe the frontend uses to decide whether to render "Controles de simulación" at all. */
  @Get('config')
  @RequirePermissions('dev_tools.simulate_execution_state')
  getConfig(): { enabled: true } {
    this.assertToolEnabled();
    return { enabled: true };
  }

  @Post(':executionId/state')
  @RequirePermissions('dev_tools.simulate_execution_state')
  async setState(
    @CurrentUser() user: AuthenticatedUser,
    @Param('executionId') executionId: string,
    @Body() dto: SimulateExecutionStateDto,
  ) {
    this.assertToolEnabled();
    return this.simulation.apply(user.organizationId, user.id, executionId, dto);
  }
}
