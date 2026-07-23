import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { IntegrationService } from '../../application/integration/integration.service';
import { AdminSequenceMonitorService } from '../../application/sequences/admin-sequence-monitor.service';
import {
  AdminSequenceDetail,
  AdminSequenceListRow,
} from '../../application/sequences/admin-sequence-monitor.types';
import { SequencePublishService } from '../../application/sequences/sequence-publish.service';
import { SequencesService } from '../../application/sequences/sequences.service';
import {
  SchedulePreview,
  SequenceDeletionResult,
  SequenceReadiness,
  SequenceSummary,
} from '../../application/sequences/sequences.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateSequenceDto } from './dto/create-sequence.dto';
import { CreateWizardSequenceForExecutiveDto } from './dto/create-wizard-sequence-for-executive.dto';
import { ListAdminSequencesDto } from './dto/list-admin-sequences.dto';
import { PublishSequenceDto } from './dto/publish-sequence.dto';
import { ReassignExecutiveDto } from './dto/reassign-executive.dto';
import { UpdateSequenceDto } from './dto/update-sequence.dto';

/**
 * No class-level route prefix — the request's endpoint shapes mix
 * `/users/:userId/sequences` (list/create, nested under the executive
 * profile) and `/sequences/:id/...` (everything else), so each method
 * declares its own full path instead of forcing one shared prefix.
 */
@ApiTags('sequences')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SequencesController {
  constructor(
    private readonly sequencesService: SequencesService,
    private readonly publishService: SequencePublishService,
    private readonly integration: IntegrationService,
    private readonly monitor: AdminSequenceMonitorService,
  ) {}

  /** Spec §4 — the global "todas las secuencias" panel's source list, with every §4.2 filter. */
  @Get('sequences')
  @RequirePermissions('sequences.read_all')
  listAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAdminSequencesDto,
  ): Promise<AdminSequenceListRow[]> {
    return this.monitor.list(user.organizationId, {
      executiveId: query.executiveId,
      clientId: query.clientId,
      mailboxId: query.mailboxId,
      status: query.status,
      activeOnly: query.activeOnly === undefined ? undefined : query.activeOnly === 'true',
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
      startedFrom: query.startedFrom,
      startedTo: query.startedTo,
      search: query.search,
    });
  }

  /** Spec §4.4 — resumen/resultados/historial de eventos/contenido for one sequence. */
  @Get('sequences/:id/monitor')
  @RequirePermissions('sequences.read_all')
  getMonitorDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AdminSequenceDetail> {
    return this.monitor.getDetail(user.organizationId, id);
  }

  /** Spec §4.5 — "Cancelar futuros envíos", distinct from archiving the sequence. */
  @Post('sequences/:id/cancel-pending-sends')
  @RequirePermissions('sequences.cancel')
  async cancelPendingSends(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ cancelledJobs: number }> {
    const cancelledJobs = await this.monitor.cancelPendingSends(user.organizationId, id, user.id);
    return { cancelledJobs };
  }

  @Get('users/:userId/sequences')
  @RequirePermissions('sequences.read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<SequenceSummary[]> {
    return this.sequencesService.listForExecutive(user.organizationId, userId);
  }

  @Post('users/:userId/sequences')
  @RequirePermissions('sequences.create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: CreateSequenceDto,
  ): Promise<SequenceSummary> {
    return this.sequencesService.create(user.organizationId, userId, dto, user.id);
  }

  /** Spec §3 — the admin wizard's "Configuración general" step, targeting an explicit executive. */
  @Post('users/:userId/sequences/wizard')
  @RequirePermissions('sequences.create', 'sequences.assign')
  createFromWizard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: CreateWizardSequenceForExecutiveDto,
  ): Promise<SequenceSummary> {
    return this.sequencesService.createFromWizardForExecutive(user.organizationId, userId, dto, user.id);
  }

  @Get('sequences/:id')
  @RequirePermissions('sequences.read')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceSummary> {
    return this.sequencesService.getById(user.organizationId, id);
  }

  /** Spec §3.1 — reassigns operational ownership; `createdBy` never changes. */
  @Patch('sequences/:id/reassign-executive')
  @RequirePermissions('sequences.reassign')
  reassignExecutive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReassignExecutiveDto,
  ): Promise<SequenceSummary> {
    return this.sequencesService.reassignExecutive(user.organizationId, id, dto, user.id);
  }

  /** Admin equivalent of MeSequencesController.publish — same underlying service call, no ownership check. */
  @Post('sequences/:id/publish')
  @RequirePermissions('sequences.publish')
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PublishSequenceDto,
  ) {
    const { sequence, command, duplicate } = await this.publishService.publish(
      user.organizationId,
      id,
      user.id,
      dto.idempotencyKey,
      dto.scenario,
    );
    return {
      sequence: await this.sequencesService.getById(user.organizationId, sequence.id),
      command: { ...command, payload: this.integration.redact(command.payload) },
      duplicate,
    };
  }

  @Patch('sequences/:id')
  @RequirePermissions('sequences.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSequenceDto,
  ): Promise<SequenceSummary> {
    return this.sequencesService.update(user.organizationId, id, dto, user.id);
  }

  @Post('sequences/:id/duplicate')
  @RequirePermissions('sequences.create')
  duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceSummary> {
    return this.sequencesService.duplicate(user.organizationId, id, user.id);
  }

  @Post('sequences/:id/pause')
  @RequirePermissions('sequences.pause')
  pause(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<SequenceSummary> {
    return this.sequencesService.pause(user.organizationId, id, user.id);
  }

  @Post('sequences/:id/resume')
  @RequirePermissions('sequences.pause')
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceSummary> {
    return this.sequencesService.resume(user.organizationId, id, user.id);
  }

  @Post('sequences/:id/archive')
  @RequirePermissions('sequences.archive')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceSummary> {
    return this.sequencesService.archive(user.organizationId, id, user.id);
  }

  @Post('sequences/:id/restore')
  @RequirePermissions('sequences.archive')
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceSummary> {
    return this.sequencesService.restore(user.organizationId, id, user.id);
  }

  /** §7 — same live "Envío estimado" preview as MeSequencesController, org-scoped instead of owner-scoped. */
  @Get('sequences/:id/schedule-preview')
  @RequirePermissions('sequences.read')
  getSchedulePreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SchedulePreview> {
    return this.sequencesService.previewSchedule(user.organizationId, id);
  }

  @Get('sequences/:id/readiness')
  @RequirePermissions('sequences.read')
  getReadiness(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceReadiness> {
    return this.sequencesService.getReadiness(user.organizationId, id);
  }

  @Delete('sequences/:id')
  @RequirePermissions('sequences.delete')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceDeletionResult> {
    return this.sequencesService.remove(user.organizationId, id, user.id);
  }
}
