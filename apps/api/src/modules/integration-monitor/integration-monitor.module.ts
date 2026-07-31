import { Module } from '@nestjs/common';
import { DevMotorEventEmitterService } from '../../application/motor-event/dev-motor-event-emitter.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { DevMotorEventsController } from '../integration/dev-motor-events.controller';
import { IntegrationModule } from '../integration/integration.module';
import { MotorEventModule } from '../integration/motor-event.module';
import { IntegrationMonitorController } from './integration-monitor.controller';

@Module({
  imports: [AuthModule, PersistenceModule, IntegrationModule, MotorEventModule],
  controllers: [IntegrationMonitorController, DevMotorEventsController],
  providers: [DevMotorEventEmitterService],
})
export class IntegrationMonitorModule {}
