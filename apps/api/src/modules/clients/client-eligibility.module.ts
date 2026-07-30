import { Module } from '@nestjs/common';
import { ClientEligibilityService } from '../../application/clients/client-eligibility.service';
import { ClientStatusPolicy } from '../../domain/client/client-status.policy';

@Module({
  providers: [ClientStatusPolicy, ClientEligibilityService],
  exports: [ClientEligibilityService],
})
export class ClientEligibilityModule {}
