import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { VariablesService } from '../../application/variables/variables.service';
import { VariableSummary } from '../../application/variables/variables.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateVariableDto } from './dto/create-variable.dto';
import { UpdateVariableDto } from './dto/update-variable.dto';

@ApiTags('variables')
@ApiBearerAuth()
@Controller('variables')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VariablesController {
  constructor(private readonly variablesService: VariablesService) {}

  @Get()
  @RequirePermissions('variables.read')
  list(@CurrentUser() user: AuthenticatedUser): Promise<VariableSummary[]> {
    return this.variablesService.list(user.organizationId);
  }

  @Post()
  @RequirePermissions('variables.create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVariableDto,
  ): Promise<VariableSummary> {
    return this.variablesService.create(user.organizationId, dto, user.id);
  }

  @Get(':id')
  @RequirePermissions('variables.read')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<VariableSummary> {
    return this.variablesService.getById(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('variables.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateVariableDto,
  ): Promise<VariableSummary> {
    return this.variablesService.update(user.organizationId, id, dto, user.id);
  }

  @Post(':id/archive')
  @RequirePermissions('variables.archive')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<VariableSummary> {
    return this.variablesService.setStatus(user.organizationId, id, 'ARCHIVED', user.id);
  }

  @Post(':id/restore')
  @RequirePermissions('variables.archive')
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<VariableSummary> {
    return this.variablesService.setStatus(user.organizationId, id, 'ACTIVE', user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('variables.delete')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.variablesService.remove(user.organizationId, id, user.id);
  }
}
