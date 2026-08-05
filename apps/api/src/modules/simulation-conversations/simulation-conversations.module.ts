import { Module } from '@nestjs/common';
import { DeleteSimulationConversationsUseCase } from '../../application/simulation-conversations/delete-simulation-conversations.use-case';
import { GenerateSimulationConversationsUseCase } from '../../application/simulation-conversations/generate-simulation-conversations.use-case';
import { SimulationConversationsService } from '../../application/simulation-conversations/simulation-conversations.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { AdminSimulationConversationsController } from './admin-simulation-conversations.controller';

@Module({
  imports: [PersistenceModule, AuthModule, MailboxesModule],
  controllers: [AdminSimulationConversationsController],
  providers: [SimulationConversationsService, GenerateSimulationConversationsUseCase, DeleteSimulationConversationsUseCase],
})
export class SimulationConversationsModule {}
