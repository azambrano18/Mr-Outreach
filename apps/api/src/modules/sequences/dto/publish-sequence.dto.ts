import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

const SCENARIOS = ['SUCCESS', 'FAILED', 'TIMEOUT'] as const;

export class PublishSequenceDto {
  /** Deliberately resubmit the same key to demo §43's duplicate-command detection. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  /** §23/§26 — lets the demo force a failed/timed-out publish; defaults to SUCCESS. */
  @ApiPropertyOptional({ enum: SCENARIOS })
  @IsOptional()
  @IsIn(SCENARIOS)
  scenario?: (typeof SCENARIOS)[number];
}
