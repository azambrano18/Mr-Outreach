import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CrmClientsService } from '../../application/crm-clients/crm-clients.service';
import { CrmClient } from '../../domain/crm-client/crm-client.entity';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

/** Read-only proxy onto the external Neon CRM database — see AdminReorg plan Etapa 4. */
@ApiTags('crm-clients')
@ApiBearerAuth()
@Controller('crm-clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CrmClientsController {
  constructor(private readonly crmClientsService: CrmClientsService) {}

  @Get()
  @RequirePermissions('crm_clients.read')
  list(@Query('search') search?: string): Promise<CrmClient[]> {
    return this.crmClientsService.list(search);
  }

  @Get(':crmClientId')
  @RequirePermissions('crm_clients.read')
  getById(@Param('crmClientId', ParseIntPipe) crmClientId: number): Promise<CrmClient> {
    return this.crmClientsService.getById(crmClientId);
  }
}
