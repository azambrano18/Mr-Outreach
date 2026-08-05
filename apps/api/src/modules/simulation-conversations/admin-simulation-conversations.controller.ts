import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { DeleteSimulationConversationsUseCase } from '../../application/simulation-conversations/delete-simulation-conversations.use-case';
import { GenerateSimulationConversationsUseCase } from '../../application/simulation-conversations/generate-simulation-conversations.use-case';
import { SimulationConversationsService } from '../../application/simulation-conversations/simulation-conversations.service';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { GenerateSimulationConversationsDto } from './dto/generate-simulation-conversations.dto';

const ALLOWED_APP_ENVS = ['development', 'staging', 'test'];
const DISABLED_MESSAGE = 'Esta función solo está disponible en entornos de desarrollo, staging o pruebas, en modo de simulación.';

/**
 * "Conversaciones de prueba" (QA) — §5/§17: unlike the dev-tools controllers
 * elsewhere in this codebase (which 404 to hide their very existence), this
 * surface is a documented ADMIN feature that must fail with a controlled
 * 403 in production, never leave a route that "doesn't exist" ambiguity —
 * the task is explicit that "el endpoint responde 403 o error de dominio
 * controlado". The permission guard (`simulation_conversations.*`) handles
 * "who", this class's own `assertEnvironmentAllowed` handles "where" — both
 * gates are backend-only and can never be satisfied by a frontend-supplied
 * parameter.
 */
@ApiTags('admin-simulation-conversations')
@ApiBearerAuth()
@Controller('admin/simulation-conversations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminSimulationConversationsController {
  constructor(
    private readonly config: AppConfigService,
    private readonly simulationConversations: SimulationConversationsService,
    private readonly generateUseCase: GenerateSimulationConversationsUseCase,
    private readonly deleteUseCase: DeleteSimulationConversationsUseCase,
  ) {}

  private assertEnvironmentAllowed(): void {
    if (!ALLOWED_APP_ENVS.includes(this.config.appEnv) || this.config.mailEngineMode !== 'simulation') {
      throw new ForbiddenException(DISABLED_MESSAGE);
    }
  }

  @Get('eligible-mailboxes')
  @RequirePermissions('simulation_conversations.create')
  eligibleMailboxes(@CurrentUser() user: AuthenticatedUser) {
    this.assertEnvironmentAllowed();
    return this.simulationConversations.listEligibleMailboxes(user.organizationId, user.id);
  }

  @Get('active-batch')
  @RequirePermissions('simulation_conversations.create')
  activeBatch(@CurrentUser() user: AuthenticatedUser) {
    this.assertEnvironmentAllowed();
    return this.simulationConversations.getActiveBatch(user.organizationId);
  }

  @Get(':batchId/delete-preview')
  @RequirePermissions('simulation_conversations.delete')
  deletePreview(@CurrentUser() user: AuthenticatedUser, @Param('batchId') batchId: string) {
    this.assertEnvironmentAllowed();
    return this.deleteUseCase.preview(user.organizationId, batchId);
  }

  @Post('generate')
  @RequirePermissions('simulation_conversations.create')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateSimulationConversationsDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    this.assertEnvironmentAllowed();
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    return this.generateUseCase.execute({
      organizationId: user.organizationId,
      actorId: user.id,
      mailboxId: dto.mailboxId,
      idempotencyKey,
    });
  }

  @Delete(':batchId')
  @RequirePermissions('simulation_conversations.delete')
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('batchId') batchId: string) {
    this.assertEnvironmentAllowed();
    return this.deleteUseCase.execute(user.organizationId, user.id, batchId);
  }
}
