import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { ClientsService } from '../../application/clients/clients.service';
import { ManagedClientSummary } from '../../application/clients/clients.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

/** "Mis clientes" — the executive's self-service entry point (§8 of the client-hierarchy pivot). */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @RequirePermissions('clients.read.assigned')
  list(@CurrentUser() user: AuthenticatedUser): Promise<ManagedClientSummary[]> {
    return this.clientsService.listForExecutive(user.organizationId, user.id);
  }

  @Get(':id')
  @RequirePermissions('clients.read.assigned')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ManagedClientSummary> {
    return this.clientsService.getByIdForExecutive(user.organizationId, user.id, id);
  }
}
