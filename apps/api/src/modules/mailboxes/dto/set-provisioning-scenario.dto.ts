import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { MailboxProvisionScenario } from '../../../infrastructure/mail-engine/simulated/simulated-mail-engine-adapter';

const SCENARIOS: MailboxProvisionScenario[] = [
  'SUCCESS',
  'IMAP_ERROR',
  'SMTP_ERROR',
  'AUTH_ERROR',
  'TIMEOUT',
  'GENERAL_FAILURE',
];

export class SetProvisioningScenarioDto {
  @ApiProperty({ enum: SCENARIOS })
  @IsIn(SCENARIOS)
  scenario!: MailboxProvisionScenario;
}
