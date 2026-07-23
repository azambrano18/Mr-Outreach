import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

const SCENARIOS = [
  'INTERESTED',
  'NOT_INTERESTED',
  'REQUESTS_INFORMATION',
  'FOLLOW_UP_LATER',
  'WRONG_CONTACT',
  'OUT_OF_OFFICE',
  'AUTOMATIC_REPLY',
  'HARD_BOUNCE',
  'SOFT_BOUNCE',
  'UNSUBSCRIBE',
  'UNIDENTIFIED',
] as const;

export class SimulateReplyDto {
  @ApiProperty({ enum: SCENARIOS })
  @IsIn(SCENARIOS)
  scenario!: (typeof SCENARIOS)[number];
}
