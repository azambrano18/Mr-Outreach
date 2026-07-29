import { Module } from '@nestjs/common';
import { ExecutiveMailboxEligibilityService } from '../../application/sequence-templates/executive-mailbox-eligibility.service';
import { PublishSequenceTemplateUseCase } from '../../application/sequence-templates/publish-sequence-template.use-case';
import { SequenceTemplatesService } from '../../application/sequence-templates/sequence-templates.service';
import { UpdateSequenceTemplateUseCase } from '../../application/sequence-templates/update-sequence-template.use-case';
import { MailboxMotorModule } from '../../infrastructure/mailbox-motor/mailbox-motor.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { SecurityModule } from '../../infrastructure/security/security.module';
import { SequenceTemplateMotorModule } from '../../infrastructure/sequence-template-motor/sequence-template-motor.module';
import { AuthModule } from '../auth/auth.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { SignaturesModule } from '../signatures/signatures.module';
import { MeSequenceTemplatesController } from './me-sequence-templates.controller';

@Module({
  imports: [
    PersistenceModule,
    SecurityModule,
    AuthModule,
    MailboxesModule,
    SignaturesModule,
    MailboxMotorModule,
    SequenceTemplateMotorModule,
  ],
  controllers: [MeSequenceTemplatesController],
  providers: [SequenceTemplatesService, PublishSequenceTemplateUseCase, UpdateSequenceTemplateUseCase, ExecutiveMailboxEligibilityService],
  exports: [SequenceTemplatesService, ExecutiveMailboxEligibilityService],
})
export class SequenceTemplatesModule {}
