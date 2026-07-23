import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { SequenceStepsService } from '../../application/sequences/sequence-steps.service';
import {
  SendTestStepResult,
  SequenceStepPreview,
  SequenceStepSummary,
  SequenceStepVersionSummary,
} from '../../application/sequences/sequence-steps.types';
import { SequencesService } from '../../application/sequences/sequences.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateSequenceStepDto } from './dto/create-sequence-step.dto';
import { ReorderSequenceStepsDto } from './dto/reorder-sequence-steps.dto';
import { SendTestStepDto } from './dto/send-test-step.dto';
import { UpdateSequenceStepDto } from './dto/update-sequence-step.dto';

/**
 * Self-service mirror of SequenceStepsController, gated by
 * `sequence_steps.manage.own`. The `sequences/:id/steps` routes verify the
 * parent sequence belongs to the caller before touching it; the
 * `sequence-steps/:stepId` routes verify through the step's own parent
 * sequence (SequenceStepsService.requireOwnedByExecutive).
 */
@ApiTags('me-sequence-steps')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeSequenceStepsController {
  constructor(
    private readonly stepsService: SequenceStepsService,
    private readonly sequencesService: SequencesService,
  ) {}

  @Get('sequences/:id/steps')
  @RequirePermissions('sequence_steps.manage.own')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sequenceId: string,
  ): Promise<SequenceStepSummary[]> {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, sequenceId, user.id);
    return this.stepsService.listBySequence(user.organizationId, sequenceId);
  }

  @Post('sequences/:id/steps')
  @RequirePermissions('sequence_steps.manage.own')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sequenceId: string,
    @Body() dto: CreateSequenceStepDto,
  ): Promise<SequenceStepSummary> {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, sequenceId, user.id);
    return this.stepsService.create(user.organizationId, sequenceId, dto, user.id);
  }

  @Put('sequences/:id/steps/reorder')
  @RequirePermissions('sequence_steps.manage.own')
  async reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sequenceId: string,
    @Body() dto: ReorderSequenceStepsDto,
  ): Promise<SequenceStepSummary[]> {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, sequenceId, user.id);
    return this.stepsService.reorder(user.organizationId, sequenceId, dto.stepIds, user.id);
  }

  @Get('sequence-steps/:stepId')
  @RequirePermissions('sequence_steps.manage.own')
  async getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
  ): Promise<SequenceStepSummary> {
    return this.stepsService.requireOwnedByExecutive(user.organizationId, stepId, user.id);
  }

  @Patch('sequence-steps/:stepId')
  @RequirePermissions('sequence_steps.manage.own')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateSequenceStepDto,
  ): Promise<SequenceStepSummary> {
    await this.stepsService.requireOwnedByExecutive(user.organizationId, stepId, user.id);
    return this.stepsService.update(user.organizationId, stepId, dto, user.id);
  }

  @Delete('sequence-steps/:stepId')
  @HttpCode(204)
  @RequirePermissions('sequence_steps.manage.own')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
  ): Promise<void> {
    await this.stepsService.requireOwnedByExecutive(user.organizationId, stepId, user.id);
    await this.stepsService.remove(user.organizationId, stepId, user.id);
  }

  @Post('sequence-steps/:stepId/duplicate')
  @RequirePermissions('sequence_steps.manage.own')
  async duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
  ): Promise<SequenceStepSummary> {
    await this.stepsService.requireOwnedByExecutive(user.organizationId, stepId, user.id);
    return this.stepsService.duplicate(user.organizationId, stepId, user.id);
  }

  @Get('sequence-steps/:stepId/versions')
  @RequirePermissions('sequence_steps.manage.own')
  async getVersions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
  ): Promise<SequenceStepVersionSummary[]> {
    await this.stepsService.requireOwnedByExecutive(user.organizationId, stepId, user.id);
    return this.stepsService.getVersions(user.organizationId, stepId);
  }

  @Get('sequence-steps/:stepId/preview')
  @RequirePermissions('sequence_steps.manage.own')
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
  ): Promise<SequenceStepPreview> {
    await this.stepsService.requireOwnedByExecutive(user.organizationId, stepId, user.id);
    return this.stepsService.preview(user.organizationId, stepId);
  }

  @Post('sequence-steps/:stepId/send-test')
  @RequirePermissions('sequence_steps.manage.own')
  async sendTest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
    @Body() dto: SendTestStepDto,
  ): Promise<SendTestStepResult> {
    await this.stepsService.requireOwnedByExecutive(user.organizationId, stepId, user.id);
    return this.stepsService.sendTest(user.organizationId, stepId, dto.to, user.id);
  }
}
