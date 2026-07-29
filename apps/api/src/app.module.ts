import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigModule } from './infrastructure/config/app-config.module';
import { envValidationSchema } from './infrastructure/config/env.validation';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClientsModule } from './modules/clients/clients.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { CrmClientsModule } from './modules/crm-clients/crm-clients.module';
import { DomainsModule } from './modules/domains/domains.module';
import { HealthModule } from './modules/health/health.module';
import { IntegrationMonitorModule } from './modules/integration-monitor/integration-monitor.module';
import { MailboxesModule } from './modules/mailboxes/mailboxes.module';
import { ReplySimulationModule } from './modules/reply-simulation/reply-simulation.module';
import { RolesModule } from './modules/roles/roles.module';
import { SeedModule } from './modules/seed/seed.module';
import { SequenceContactsModule } from './modules/sequence-contacts/sequence-contacts.module';
import { SequenceExecutionsModule } from './modules/sequence-executions/sequence-executions.module';
import { SequenceImportsModule } from './modules/sequence-imports/sequence-imports.module';
import { SequenceTemplatesModule } from './modules/sequence-templates/sequence-templates.module';
import { SequencesModule } from './modules/sequences/sequences.module';
import { SignaturesModule } from './modules/signatures/signatures.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';
import { VariablesModule } from './modules/variables/variables.module';

const NODE_ENV = process.env.NODE_ENV ?? 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Checked in order; the first file to define a given key wins, and
      // missing files are silently skipped. This lets Development /
      // Staging / Production each carry their own DATABASE_URL without any
      // of them ever being committed (see .gitignore) — only the
      // ".env.<environment>.example" templates are versioned.
      envFilePath: [`.env.${NODE_ENV}`, '.env', `../../.env.${NODE_ENV}`, '../../.env'],
      // Fails fast on boot if a variable required by the selected
      // PERSISTENCE_DRIVER/ENGINE_DRIVER is missing — see env.validation.ts.
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    AppConfigModule,
    HealthModule,
    AuthModule,
    SeedModule,
    UsersModule,
    RolesModule,
    MailboxesModule,
    TemplatesModule,
    VariablesModule,
    SignaturesModule,
    UploadsModule,
    SequencesModule,
    SequenceImportsModule,
    SequenceContactsModule,
    SequenceTemplatesModule,
    SequenceExecutionsModule,
    ReplySimulationModule,
    ClientsModule,
    DomainsModule,
    CrmClientsModule,
    ConversationsModule,
    AuditModule,
    IntegrationMonitorModule,
  ],
})
export class AppModule {}
