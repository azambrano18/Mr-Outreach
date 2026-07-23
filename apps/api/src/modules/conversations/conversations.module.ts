import { Module } from '@nestjs/common';
import { ConversationsService } from '../../application/conversations/conversations.service';
import { ResponseOutcomeService } from '../../application/response-outcome/response-outcome.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { IntegrationModule } from '../integration/integration.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { SequenceImportsModule } from '../sequence-imports/sequence-imports.module';
import { SequencesModule } from '../sequences/sequences.module';
import {
  ConversationNotesController,
  MeConversationNotesController,
} from './conversation-notes.controller';
import { ConversationHierarchyController } from './conversation-hierarchy.controller';
import { ConversationTagsController } from './conversation-tags.controller';
import { ConversationsController } from './conversations.controller';
import { MeConversationsController } from './me-conversations.controller';
import { UnmatchedMessagesController } from './unmatched-messages.controller';

@Module({
  imports: [
    PersistenceModule,
    AuthModule,
    MailboxesModule,
    SequencesModule,
    IntegrationModule,
    SequenceImportsModule,
  ],
  controllers: [
    ConversationsController,
    ConversationHierarchyController,
    MeConversationsController,
    ConversationTagsController,
    ConversationNotesController,
    MeConversationNotesController,
    UnmatchedMessagesController,
  ],
  providers: [ConversationsService, ResponseOutcomeService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
