import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { IntegrationService } from '../../application/integration/integration.service';
import { SequenceImportsService } from '../../application/sequence-imports/sequence-imports.service';
import { SequencesService } from '../../application/sequences/sequences.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AdvanceImportDto } from './dto/advance-import.dto';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { SetImportMappingDto } from './dto/set-import-mapping.dto';
import { SetImportScenarioDto } from './dto/set-import-scenario.dto';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/**
 * Admin equivalent of MeSequenceImportsController — used by the admin
 * sequence wizard (spec §3) once a sequence has been created on behalf of
 * another executive via SequencesController.createFromWizard. Only `list`
 * and `upload` needed an ownership check in the self-service version
 * (SequenceImportsService's other methods are already org-scoped, not
 * owner-scoped); here the equivalent check is `sequencesService.getById`,
 * which 404s for a sequence outside this organization — never a 403.
 */
@ApiTags('sequence-imports')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SequenceImportsController {
  constructor(
    private readonly imports: SequenceImportsService,
    private readonly sequencesService: SequencesService,
    private readonly integration: IntegrationService,
  ) {}

  @Get('sequences/:sequenceId/imports')
  @RequirePermissions('sequence_imports.read')
  async list(@CurrentUser() user: AuthenticatedUser, @Param('sequenceId') sequenceId: string) {
    await this.sequencesService.getById(user.organizationId, sequenceId);
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
    await this.sequencesService.getById(user.organizationId, sequenceId);
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

  @Post('sequence-imports/:importId/confirm')
  @RequirePermissions('sequence_imports.create')
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importId') importId: string,
    @Body() dto: ConfirmImportDto,
  ) {
    const {
      import: importRow,
      command,
      duplicate,
    } = await this.imports.confirm(user.organizationId, importId, user.id, dto.idempotencyKey);
    return {
      import: importRow,
      command: { ...command, payload: this.integration.redact(command.payload) },
      duplicate,
    };
  }

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
