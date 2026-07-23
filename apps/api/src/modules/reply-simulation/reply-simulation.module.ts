import { Module } from '@nestjs/common';
import { ReplySimulationService } from '../../application/reply-simulation/reply-simulation.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { IntegrationModule } from '../integration/integration.module';
import { SequenceImportsModule } from '../sequence-imports/sequence-imports.module';
import { SequencesModule } from '../sequences/sequences.module';
import { MeReplySimulationController } from './me-reply-simulation.controller';

@Module({
  imports: [
    PersistenceModule,
    AuthModule,
    IntegrationModule,
    SequencesModule,
    SequenceImportsModule,
    ConversationsModule,
  ],
  controllers: [MeReplySimulationController],
  providers: [ReplySimulationService],
  exports: [ReplySimulationService],
})
export class ReplySimulationModule {}
