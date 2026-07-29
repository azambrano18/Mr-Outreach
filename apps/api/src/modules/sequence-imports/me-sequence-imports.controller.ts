import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { ConfirmProspectImportUseCase } from '../../application/sequence-imports/confirm-prospect-import.use-case';
import { IntegrationService } from '../../application/integration/integration.service';
import { SequenceImportsService } from '../../application/sequence-imports/sequence-imports.service';
import { SequencesService } from '../../application/sequences/sequences.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AdvanceImportDto } from './dto/advance-import.dto';
import { SetImportMappingDto } from './dto/set-import-mapping.dto';
import { SetImportScenarioDto } from './dto/set-import-scenario.dto';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** §17-22 — self-service: an executive imports contacts only into their own sequences. */
@ApiTags('me-sequence-imports')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeSequenceImportsController {
  constructor(
    private readonly imports: SequenceImportsService,
    private readonly sequencesService: SequencesService,
    private readonly integration: IntegrationService,
    private readonly confirmImport: ConfirmProspectImportUseCase,
  ) {}

  @Get('sequences/:sequenceId/imports')
  @RequirePermissions('sequence_imports.read')
  async list(@CurrentUser() user: AuthenticatedUser, @Param('sequenceId') sequenceId: string) {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, sequenceId, user.id);
    return this.imports.list(user.organizationId, sequenceId);
  }

  @Post('sequences/:sequenceId/imports')
  @RequirePermissions('sequence_imports.create')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sequenceId') sequenceId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, sequenceId, user.id);
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    return this.imports.upload(user.organizationId, sequenceId, user.id, {
      buffer: file.buffer,
      originalName: file.originalname,
    });
  }

  @Post('sequence-imports/:importId/mapping')
  @RequirePermissions('sequence_imports.create')
  mapAndValidate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importId') importId: string,
    @Body() dto: SetImportMappingDto,
  ) {
    return this.imports.setMappingAndValidate(user.organizationId, importId, dto, user.id);
  }

  /** Fase 2, Caso B — single, atomic, idempotent confirmation (see the admin controller's twin for the full rationale). */
  @Post('sequence-imports/:importId/confirm')
  @RequirePermissions('sequence_imports.create')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importId') importId: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const importRow = await this.imports.getById(user.organizationId, importId);
    const { result } = await this.confirmImport.execute({
      organizationId: user.organizationId,
      importId,
      sequenceId: importRow.sequenceId,
      actorId: user.id,
      idempotencyKey,
    });
    return result;
  }

  /** §41 — choose the outcome the NEXT simulated advance will follow for this import's command. */
  @Post('sequence-imports/:importId/scenario')
  @RequirePermissions('sequence_imports.create')
  async setScenario(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importId') importId: string,
    @Body() dto: SetImportScenarioDto,
  ) {
    const importRow = await this.imports.getById(user.organizationId, importId);
    if (!importRow.commandId) {
      throw new BadRequestException('Esta importación todavía no tiene un comando asociado.');
    }
    this.imports.setScenario(importRow.commandId, dto.scenario);
    return { ok: true };
  }

  @Post('sequence-imports/:importId/advance')
  @RequirePermissions('sequence_imports.create')
  advance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importId') importId: string,
    @Body() dto: AdvanceImportDto,
  ) {
    return this.imports.advance(user.organizationId, importId, dto.mode, user.id);
  }

  /** §40 — JSON viewer: the submitted command (redacted) plus every planned/recorded event for it. */
  @Get('sequence-imports/:importId/command')
  @RequirePermissions('sequence_imports.read')
  async getCommand(@CurrentUser() user: AuthenticatedUser, @Param('importId') importId: string) {
    const importRow = await this.imports.getById(user.organizationId, importId);
    if (!importRow.commandId) {
      return { command: null, events: [] };
    }
    const command = await this.integration.getCommand(user.organizationId, importRow.commandId);
    const events = await this.integration.listEventsForCommand(user.organizationId, importRow.commandId);
    return { command: { ...command, payload: this.integration.redact(command.payload) }, events };
  }
}
