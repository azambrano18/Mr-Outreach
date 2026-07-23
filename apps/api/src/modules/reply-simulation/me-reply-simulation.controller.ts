import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { ConversationsService } from '../../application/conversations/conversations.service';
import { ReplySimulationService } from '../../application/reply-simulation/reply-simulation.service';
import { SchedulingService } from '../../application/scheduling/scheduling.service';
import { SequencesService } from '../../application/sequences/sequences.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SimulateReplyDto } from './dto/simulate-reply.dto';

/** §33-36 — self-service: simulating a reply/bounce to one of the executive's own sent messages. */
@ApiTags('me-reply-simulation')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeReplySimulationController {
  constructor(
    private readonly replySimulation: ReplySimulationService,
    private readonly scheduling: SchedulingService,
    private readonly sequencesService: SequencesService,
    private readonly conversationsService: ConversationsService,
  ) {}

  @Post('scheduled-emails/:id/simulate-reply')
  @RequirePermissions('sequences.manage.own')
  async simulateReply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SimulateReplyDto,
  ) {
    const scheduledEmail = await this.scheduling.getById(user.organizationId, id);
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, scheduledEmail.sequenceId, user.id);
    const { event, conversation } = await this.replySimulation.simulateReply(
      user.organizationId,
      id,
      dto.scenario,
      user.id,
    );
    return {
      event,
      conversation: conversation ? await this.conversationsService.getById(user.organizationId, conversation.id) : null,
    };
  }
}
