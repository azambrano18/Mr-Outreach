import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { TemplatesService } from '../../application/templates/templates.service';
import { TemplateSummary } from '../../application/templates/templates.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@ApiTags('templates')
@ApiBearerAuth()
@Controller('templates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  @RequirePermissions('templates.read')
  list(@CurrentUser() user: AuthenticatedUser): Promise<TemplateSummary[]> {
    return this.templatesService.list(user.organizationId);
  }

  @Post()
  @RequirePermissions('templates.create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTemplateDto,
  ): Promise<TemplateSummary> {
    return this.templatesService.create(user.organizationId, dto, user.id);
  }

  @Get(':id')
  @RequirePermissions('templates.read')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TemplateSummary> {
    return this.templatesService.getById(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('templates.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ): Promise<TemplateSummary> {
    return this.templatesService.update(user.organizationId, id, dto, user.id);
  }

  @Post(':id/duplicate')
  @RequirePermissions('templates.duplicate')
  duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TemplateSummary> {
    return this.templatesService.duplicate(user.organizationId, id, user.id);
  }

  @Post(':id/archive')
  @RequirePermissions('templates.archive')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TemplateSummary> {
    return this.templatesService.setStatus(user.organizationId, id, 'ARCHIVED', user.id);
  }

  @Post(':id/restore')
  @RequirePermissions('templates.archive')
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TemplateSummary> {
    return this.templatesService.setStatus(user.organizationId, id, 'ACTIVE', user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('templates.delete')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.templatesService.softDelete(user.organizationId, id, user.id);
  }
}
