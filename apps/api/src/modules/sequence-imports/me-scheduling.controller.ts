import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { SchedulingService } from '../../application/scheduling/scheduling.service';
import { SequencesService } from '../../application/sequences/sequences.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SimulateSendDto } from './dto/simulate-send.dto';

/** §23-25 — batching/limits + "Simular envío", scoped to the executive's own sequences. */
@ApiTags('me-scheduling')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeSchedulingController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly sequencesService: SequencesService,
  ) {}

  @Post('sequences/:sequenceId/batches')
  @RequirePermissions('sequences.manage.own')
  async createBatch(@CurrentUser() user: AuthenticatedUser, @Param('sequenceId') sequenceId: string) {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, sequenceId, user.id);
    return this.scheduling.createBatch(user.organizationId, sequenceId, user.id);
  }

  @Get('sequences/:sequenceId/scheduled-emails')
  @RequirePermissions('sequences.manage.own')
  async list(@CurrentUser() user: AuthenticatedUser, @Param('sequenceId') sequenceId: string) {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, sequenceId, user.id);
    return this.scheduling.listForSequence(user.organizationId, sequenceId);
  }

  @Post('scheduled-emails/:id/simulate-send')
  @RequirePermissions('sequences.manage.own')
  async simulateSend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SimulateSendDto,
  ) {
    const scheduledEmail = await this.scheduling.getById(user.organizationId, id);
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, scheduledEmail.sequenceId, user.id);
    return this.scheduling.simulateSend(user.organizationId, id, user.id, dto.outcome ?? 'SENT');
  }
}
