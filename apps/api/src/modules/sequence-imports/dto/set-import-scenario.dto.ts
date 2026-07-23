import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

const SCENARIOS = [
  'ALL_ACCEPTED',
  'WITH_DUPLICATES',
  'WITH_INVALID',
  'WITH_EXCLUDED',
  'PARTIALLY_COMPLETED',
  'FAILED',
  'TIMEOUT',
] as const;

export class SetImportScenarioDto {
  @ApiProperty({ enum: SCENARIOS })
  @IsIn(SCENARIOS)
  scenario!: (typeof SCENARIOS)[number];
}
