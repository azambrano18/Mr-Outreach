import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ManagedClientSummary } from '../../application/clients/clients.types';
import { ClientsService } from '../../application/clients/clients.service';
import { UsersService } from '../../application/users/users.service';
import { CreateUserResult, DeletionImpact, ResetPasswordResult, UserSummary } from '../../application/users/users.types';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { DeleteUserDto } from './dto/delete-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly clientsService: ClientsService,
  ) {}

  @Get()
  @RequirePermissions('users.read')
  list(@CurrentUser() user: AuthenticatedUser): Promise<UserSummary[]> {
    return this.usersService.list(user.organizationId);
  }

  @Post()
  @RequirePermissions('users.create')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUserDto): Promise<CreateUserResult> {
    return this.usersService.create(user.organizationId, dto, user.id);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<UserSummary> {
    return this.usersService.getById(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserSummary> {
    return this.usersService.update(user.organizationId, id, dto, user.id);
  }

  @Post(':id/activate')
  @RequirePermissions('users.disable')
  activate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<UserSummary> {
    return this.usersService.setStatus(user.organizationId, id, 'ACTIVE', user.id);
  }

  @Post(':id/deactivate')
  @RequirePermissions('users.disable')
  deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<UserSummary> {
    return this.usersService.setStatus(user.organizationId, id, 'INACTIVE', user.id);
  }

  @Post(':id/reset-password')
  @RequirePermissions('users.reset_password')
  resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ResetPasswordResult> {
    return this.usersService.resetPassword(user.organizationId, id, user.id);
  }

  @Get(':id/deletion-impact')
  @RequirePermissions('users.delete')
  getDeletionImpact(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<DeletionImpact> {
    return this.usersService.getDeletionImpact(user.organizationId, id, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('users.delete')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: DeleteUserDto): Promise<void> {
    return this.usersService.remove(user.organizationId, id, user.id, dto?.reason);
  }

  @Get(':id/clients')
  @RequirePermissions('clients.read.all')
  async getAssignedClients(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ManagedClientSummary[]> {
    await this.usersService.getById(user.organizationId, id); // 404s if not owned by this organization
    return this.clientsService.listForExecutive(user.organizationId, id);
  }
}
