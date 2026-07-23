import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrationModule } from '../integration/integration.module';
import { IntegrationMonitorController } from './integration-monitor.controller';

@Module({
  imports: [AuthModule, IntegrationModule],
  controllers: [IntegrationMonitorController],
})
export class IntegrationMonitorModule {}
