import { BadRequestException, Controller, Get, Headers, Param, Post, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { ControlSequenceExecutionUseCase } from '../../application/sequence-executions/control-sequence-execution.use-case';
import { RestartSequenceExecutionUseCase } from '../../application/sequence-executions/restart-sequence-execution.use-case';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  PauseSequenceExecutionDto,
  ResumeSequenceExecutionDto,
  RestartSequenceExecutionDto,
  StopSequenceExecutionDto,
} from './dto/control-sequence-execution.dto';

/**
 * "Control operativo de Gestiones" — admin-only pause/resume/stop/restart.
 * Deliberately a separate controller from AdminSequenceExecutionsController
 * (whose class doc explicitly documents it as read-only monitor) so that
 * invariant stays literally true and this write surface is easy to audit
 * on its own.
 */
@ApiTags('admin-sequence-executions')
@ApiBearerAuth()
@Controller('admin/sequence-executions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminSequenceExecutionControlController {
  constructor(
    private readonly controlUseCase: ControlSequenceExecutionUseCase,
    private readonly restartUseCase: RestartSequenceExecutionUseCase,
  ) {}

  @Post(':id/pause')
  @RequirePermissions('sequence_executions.pause_all')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PauseSequenceExecutionDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.controlUseCase.execute({
      organizationId: user.organizationId,
      actorId: user.id,
      executionId: id,
      action: 'PAUSE',
      idempotencyKey,
      correlationId: dto.correlationId,
    });
  }

  @Post(':id/resume')
  @RequirePermissions('sequence_executions.resume_all')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResumeSequenceExecutionDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.controlUseCase.execute({
      organizationId: user.organizationId,
      actorId: user.id,
      executionId: id,
      action: 'RESUME',
      idempotencyKey,
      correlationId: dto.correlationId,
    });
  }

  @Post(':id/stop')
  @RequirePermissions('sequence_executions.stop_all')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: StopSequenceExecutionDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.controlUseCase.execute({
      organizationId: user.organizationId,
      actorId: user.id,
      executionId: id,
      action: 'STOP',
      idempotencyKey,
      correlationId: dto.correlationId,
      reason: dto.reason,
    });
  }

  /** Read-only — populates the restart confirmation modal (total/excluded/eligible counts) before the admin confirms. */
  @Get(':id/restart-preview')
  @RequirePermissions('sequence_executions.restart_all')
  restartPreview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.restartUseCase.preview(user.organizationId, id);
  }

  @Post(':id/restart')
  @RequirePermissions('sequence_executions.restart_all')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  restart(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RestartSequenceExecutionDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.restartUseCase.execute({
      organizationId: user.organizationId,
      actorId: user.id,
      executionId: id,
      idempotencyKey,
      correlationId: dto.correlationId,
      reason: dto.reason,
    });
  }

  private requireIdempotencyKey(idempotencyKey: string): void {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
  }
}
