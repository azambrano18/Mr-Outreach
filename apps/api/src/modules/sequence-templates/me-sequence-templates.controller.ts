import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { PublishSequenceTemplateUseCase } from '../../application/sequence-templates/publish-sequence-template.use-case';
import { SequenceTemplatesService } from '../../application/sequence-templates/sequence-templates.service';
import { UpdateSequenceTemplateUseCase } from '../../application/sequence-templates/update-sequence-template.use-case';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateSequenceTemplateDto } from './dto/create-sequence-template.dto';
import { PublishSequenceTemplateDto } from './dto/publish-sequence-template.dto';
import { UpdateSequenceTemplateStepDto } from './dto/update-sequence-template-step.dto';
import { UpdateSequenceTemplateDto } from './dto/update-sequence-template.dto';

/** Etapa "cuenta del ejecutivo" — self-service: an executive only ever sees/edits/publishes their own Plantillas (§3). */
@ApiTags('me-sequence-templates')
@ApiBearerAuth()
@Controller('me/sequence-templates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeSequenceTemplatesController {
  constructor(
    private readonly templates: SequenceTemplatesService,
    private readonly publishUseCase: PublishSequenceTemplateUseCase,
    private readonly updateUseCase: UpdateSequenceTemplateUseCase,
  ) {}

  @Get()
  @RequirePermissions('sequence_templates.read_own')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.templates.listOwn(user.organizationId, user.id);
  }

  @Post()
  @RequirePermissions('sequence_templates.create_own')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSequenceTemplateDto) {
    return this.templates.create(user.organizationId, user.id, dto);
  }

  @Get(':id')
  @RequirePermissions('sequence_templates.read_own')
  getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.templates.getDetail(user.organizationId, user.id, id);
  }

  @Patch(':id')
  @RequirePermissions('sequence_templates.update_own')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateSequenceTemplateDto) {
    return this.templates.update(user.organizationId, user.id, id, dto);
  }

  @Patch(':id/steps/:stepNumber')
  @RequirePermissions('sequence_templates.update_own')
  updateStep(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('stepNumber') stepNumber: string,
    @Body() dto: UpdateSequenceTemplateStepDto,
  ) {
    const parsed = Number(stepNumber);
    if (![1, 2, 3].includes(parsed)) {
      throw new BadRequestException('stepNumber debe ser 1, 2 o 3.');
    }
    return this.templates.updateStep(user.organizationId, user.id, id, parsed as 1 | 2 | 3, dto);
  }

  /** §9 — preflight for the confirmation modal: runs the exact same checks `publish` enforces, without publishing anything. */
  @Post(':id/validate')
  @RequirePermissions('sequence_templates.publish_own')
  validate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.templates.validateForPublish(user.organizationId, user.id, id);
  }

  @Post(':id/publish')
  @RequirePermissions('sequence_templates.publish_own')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PublishSequenceTemplateDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    return this.publishUseCase.execute({
      organizationId: user.organizationId,
      templateId: id,
      actorId: user.id,
      idempotencyKey,
      correlationId: dto.correlationId,
    });
  }

  /** §14 — preflight for the "Confirmar actualización de plantilla" modal: Mr Outreach's own local estimate, no motor call. */
  @Post(':id/update-impact')
  @RequirePermissions('sequence_templates.publish_own')
  getUpdateImpact(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.templates.getUpdateImpact(user.organizationId, user.id, id);
  }

  /** §12-17 — the only way to change content on an already-PUBLISHED template; distinct from `publish` (which is for a never-yet-published DRAFT). */
  @Post(':id/publish-update')
  @RequirePermissions('sequence_templates.publish_own')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async publishUpdate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PublishSequenceTemplateDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    return this.updateUseCase.execute({
      organizationId: user.organizationId,
      templateId: id,
      actorId: user.id,
      idempotencyKey,
      correlationId: dto.correlationId,
    });
  }

  @Post(':id/archive')
  @RequirePermissions('sequence_templates.archive_own')
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.templates.archive(user.organizationId, user.id, id);
    return { ok: true };
  }

  /** §11 — reopens an archived Plantilla as an editable draft; publishing it again produces a new version and a new template token. */
  @Post(':id/reopen')
  @RequirePermissions('sequence_templates.update_own')
  reopen(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.templates.reopenArchived(user.organizationId, user.id, id);
  }

  /** §10 — preflight for the "Eliminar" button on a PUBLISHED Plantilla; DRAFT/ARCHIVED are always deletable, so the frontend only needs this for a published one. */
  @Get(':id/deletability')
  @RequirePermissions('sequence_templates.delete_own')
  canDelete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.templates.canDeleteTemplate(user.organizationId, user.id, id);
  }

  /** §8-10 — single delete entry point; behavior (hard delete / logical delete / blocked) depends on the Plantilla's current status, see SequenceTemplatesService.deleteTemplate. */
  @Delete(':id')
  @RequirePermissions('sequence_templates.delete_own')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.templates.deleteTemplate(user.organizationId, user.id, id);
    return { ok: true };
  }
}
