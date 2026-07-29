import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { ProspectImportsService } from '../../application/prospect-imports/prospect-imports.service';
import { RefreshExecutionStatusUseCase } from '../../application/sequence-executions/refresh-execution-status.use-case';
import { SequenceExecutionsService } from '../../application/sequence-executions/sequence-executions.service';
import { StartSequenceExecutionUseCase } from '../../application/sequence-executions/start-sequence-execution.use-case';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateSequenceExecutionDto } from './dto/create-sequence-execution.dto';
import { SetProspectMappingDto } from './dto/set-prospect-mapping.dto';
import { StartSequenceExecutionDto } from './dto/start-sequence-execution.dto';
import { UpdateDraftSequenceExecutionDto } from './dto/update-sequence-execution.dto';

const MAX_PROSPECT_FILE_BYTES = 10 * 1024 * 1024;

/** Etapa "cuenta del ejecutivo" — self-service: an executive only ever sees/creates/starts their own Gestiones (§3). */
@ApiTags('me-sequence-executions')
@ApiBearerAuth()
@Controller('me/sequence-executions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeSequenceExecutionsController {
  constructor(
    private readonly executions: SequenceExecutionsService,
    private readonly prospectImports: ProspectImportsService,
    private readonly startUseCase: StartSequenceExecutionUseCase,
    private readonly refreshUseCase: RefreshExecutionStatusUseCase,
  ) {}

  @Get()
  @RequirePermissions('sequence_executions.read_own')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.executions.listOwn(user.organizationId, user.id);
  }

  @Post()
  @RequirePermissions('sequence_executions.create_own')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSequenceExecutionDto) {
    return this.executions.create(user.organizationId, user.id, {
      mailboxId: dto.mailboxId,
      templateId: dto.templateId,
    });
  }

  @Get(':id')
  @RequirePermissions('sequence_executions.read_own')
  getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.executions.getOwned(user.organizationId, user.id, id);
  }

  /** §10 — only while DRAFT; enforced in the service. */
  @Patch(':id')
  @RequirePermissions('sequence_executions.update_own')
  updateDraft(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateDraftSequenceExecutionDto) {
    return this.executions.updateDraft(user.organizationId, user.id, id, dto);
  }

  /** §10 — only while DRAFT; never sends anything to Railway. */
  @Delete(':id')
  @RequirePermissions('sequence_executions.delete_own')
  async deleteDraft(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.executions.deleteDraft(user.organizationId, user.id, id);
    return { ok: true };
  }

  @Post(':id/import')
  @RequirePermissions('sequence_executions.import_own')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PROSPECT_FILE_BYTES } }))
  async uploadProspects(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    return this.prospectImports.uploadFile(user.organizationId, user.id, id, {
      buffer: file.buffer,
      originalName: file.originalname,
    });
  }

  @Get(':id/import/required-variables')
  @RequirePermissions('sequence_executions.import_own')
  getRequiredVariables(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.prospectImports
      .getRequiredVariables(user.organizationId, user.id, id)
      .then((variables) => ({ variables }));
  }

  @Post(':id/mapping')
  @RequirePermissions('sequence_executions.import_own')
  setMapping(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SetProspectMappingDto) {
    return this.prospectImports.setMapping(user.organizationId, user.id, id, dto);
  }

  @Post(':id/start')
  @RequirePermissions('sequence_executions.start_own')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: StartSequenceExecutionDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    return this.startUseCase.execute({
      organizationId: user.organizationId,
      executiveId: user.id,
      executionId: id,
      idempotencyKey,
      correlationId: dto.correlationId,
    });
  }

  @Post(':id/refresh-status')
  @RequirePermissions('sequence_executions.refresh_status_own')
  async refreshStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.executions.requireOwned(user.organizationId, user.id, id);
    return this.refreshUseCase.execute(user.organizationId, user.id, id);
  }
}
