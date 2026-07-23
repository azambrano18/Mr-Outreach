import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IntegrationService } from '../../application/integration/integration.service';
import { AuthenticatedUser } from '../../application/auth/auth.types';
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
import { CreateWizardSequenceDto } from './dto/create-wizard-sequence.dto';
import { PublishSequenceDto } from './dto/publish-sequence.dto';
import { UpdateSequenceDto } from './dto/update-sequence.dto';

/**
 * Self-service mirror of SequencesController: an executive manages only
 * their own sequences, on mailboxes the admin already assigned them —
 * `sequences.manage.own` is the sole permission key gating all of it,
 * and every id-scoped route re-verifies ownership through
 * SequencesService.requireOwnedByExecutive (404, never 403, for a
 * colleague's sequence).
 */
@ApiTags('me-sequences')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeSequencesController {
  constructor(
    private readonly sequencesService: SequencesService,
    private readonly publishService: SequencePublishService,
    private readonly integration: IntegrationService,
  ) {}

  @Get('sequences')
  @RequirePermissions('sequences.manage.own')
  list(@CurrentUser() user: AuthenticatedUser): Promise<SequenceSummary[]> {
    return this.sequencesService.listForExecutive(user.organizationId, user.id);
  }

  @Post('sequences')
  @RequirePermissions('sequences.manage.own')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSequenceDto,
  ): Promise<SequenceSummary> {
    return this.sequencesService.create(user.organizationId, user.id, dto, user.id);
  }

  /** §5/§10-11 — the "Crear secuencia" wizard's step 1: creates the sequence AND its 3 fixed steps in one call. */
  @Post('sequences/wizard')
  @RequirePermissions('sequences.manage.own')
  createFromWizard(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWizardSequenceDto,
  ): Promise<SequenceSummary> {
    return this.sequencesService.createFromWizard(user.organizationId, user.id, dto, user.id);
  }

  @Get('sequences/:id')
  @RequirePermissions('sequences.manage.own')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceSummary> {
    return this.sequencesService.requireOwnedByExecutive(user.organizationId, id, user.id);
  }

  @Patch('sequences/:id')
  @RequirePermissions('sequences.manage.own')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSequenceDto,
  ): Promise<SequenceSummary> {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, id, user.id);
    return this.sequencesService.update(user.organizationId, id, dto, user.id);
  }

  @Post('sequences/:id/duplicate')
  @RequirePermissions('sequences.manage.own')
  async duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceSummary> {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, id, user.id);
    return this.sequencesService.duplicate(user.organizationId, id, user.id);
  }

  @Post('sequences/:id/pause')
  @RequirePermissions('sequences.manage.own')
  async pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceSummary> {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, id, user.id);
    return this.sequencesService.pause(user.organizationId, id, user.id);
  }

  @Post('sequences/:id/resume')
  @RequirePermissions('sequences.manage.own')
  async resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceSummary> {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, id, user.id);
    return this.sequencesService.resume(user.organizationId, id, user.id);
  }

  @Post('sequences/:id/archive')
  @RequirePermissions('sequences.manage.own')
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceSummary> {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, id, user.id);
    return this.sequencesService.archive(user.organizationId, id, user.id);
  }

  @Post('sequences/:id/restore')
  @RequirePermissions('sequences.manage.own')
  async restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceSummary> {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, id, user.id);
    return this.sequencesService.restore(user.organizationId, id, user.id);
  }

  @Get('sequences/:id/readiness')
  @RequirePermissions('sequences.manage.own')
  async getReadiness(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceReadiness> {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, id, user.id);
    return this.sequencesService.getReadiness(user.organizationId, id);
  }

  /** §7 — "Envío estimado" per step, recalculated live from the sequence's current settings. */
  @Get('sequences/:id/schedule-preview')
  @RequirePermissions('sequences.manage.own')
  async getSchedulePreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SchedulePreview> {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, id, user.id);
    return this.sequencesService.previewSchedule(user.organizationId, id);
  }

  @Delete('sequences/:id')
  @RequirePermissions('sequences.manage.own')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SequenceDeletionResult> {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, id, user.id);
    return this.sequencesService.remove(user.organizationId, id, user.id);
  }

  /** §14-16 — generates SEQUENCE_PUBLISH_REQUESTED and drives it to completion. */
  @Post('sequences/:id/publish')
  @RequirePermissions('sequences.publish')
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PublishSequenceDto,
  ) {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, id, user.id);
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

  /** §40 — JSON viewer: the published command (redacted) plus every event it produced. */
  @Get('sequences/:id/publish/command')
  @RequirePermissions('sequences.publish')
  async getPublishCommand(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const sequence = await this.sequencesService.requireOwnedByExecutive(user.organizationId, id, user.id);
    if (!sequence.lastPublishCommandId) {
      return { command: null, events: [] };
    }
    const command = await this.integration.getCommand(user.organizationId, sequence.lastPublishCommandId);
    const events = await this.integration.listEventsForCommand(user.organizationId, sequence.lastPublishCommandId);
    return { command: { ...command, payload: this.integration.redact(command.payload) }, events };
  }
}
