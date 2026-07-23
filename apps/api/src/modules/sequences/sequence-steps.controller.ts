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
import {
  SendTestStepResult,
  SequenceStepPreview,
  SequenceStepSummary,
  SequenceStepVersionSummary,
} from '../../application/sequences/sequence-steps.types';
import { SequenceStepsService } from '../../application/sequences/sequence-steps.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateSequenceStepDto } from './dto/create-sequence-step.dto';
import { ReorderSequenceStepsDto } from './dto/reorder-sequence-steps.dto';
import { SendTestStepDto } from './dto/send-test-step.dto';
import { UpdateSequenceStepDto } from './dto/update-sequence-step.dto';

@ApiTags('sequence-steps')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SequenceStepsController {
  constructor(private readonly stepsService: SequenceStepsService) {}

  @Get('sequences/:id/steps')
  @RequirePermissions('sequence_steps.read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sequenceId: string,
  ): Promise<SequenceStepSummary[]> {
    return this.stepsService.listBySequence(user.organizationId, sequenceId);
  }

  @Post('sequences/:id/steps')
  @RequirePermissions('sequence_steps.create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sequenceId: string,
    @Body() dto: CreateSequenceStepDto,
  ): Promise<SequenceStepSummary> {
    return this.stepsService.create(user.organizationId, sequenceId, dto, user.id);
  }

  @Put('sequences/:id/steps/reorder')
  @RequirePermissions('sequence_steps.update')
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sequenceId: string,
    @Body() dto: ReorderSequenceStepsDto,
  ): Promise<SequenceStepSummary[]> {
    return this.stepsService.reorder(user.organizationId, sequenceId, dto.stepIds, user.id);
  }

  @Get('sequence-steps/:stepId')
  @RequirePermissions('sequence_steps.read')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
  ): Promise<SequenceStepSummary> {
    return this.stepsService.getById(user.organizationId, stepId);
  }

  @Patch('sequence-steps/:stepId')
  @RequirePermissions('sequence_steps.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateSequenceStepDto,
  ): Promise<SequenceStepSummary> {
    return this.stepsService.update(user.organizationId, stepId, dto, user.id);
  }

  @Delete('sequence-steps/:stepId')
  @HttpCode(204)
  @RequirePermissions('sequence_steps.delete')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
  ): Promise<void> {
    await this.stepsService.remove(user.organizationId, stepId, user.id);
  }

  @Post('sequence-steps/:stepId/duplicate')
  @RequirePermissions('sequence_steps.create')
  duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
  ): Promise<SequenceStepSummary> {
    return this.stepsService.duplicate(user.organizationId, stepId, user.id);
  }

  @Get('sequence-steps/:stepId/versions')
  @RequirePermissions('sequence_steps.read')
  getVersions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
  ): Promise<SequenceStepVersionSummary[]> {
    return this.stepsService.getVersions(user.organizationId, stepId);
  }

  @Get('sequence-steps/:stepId/preview')
  @RequirePermissions('sequence_steps.read')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
  ): Promise<SequenceStepPreview> {
    return this.stepsService.preview(user.organizationId, stepId);
  }

  @Post('sequence-steps/:stepId/send-test')
  @RequirePermissions('sequence_steps.test')
  sendTest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stepId') stepId: string,
    @Body() dto: SendTestStepDto,
  ): Promise<SendTestStepResult> {
    return this.stepsService.sendTest(user.organizationId, stepId, dto.to, user.id);
  }
}
