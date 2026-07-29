import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Dev-only simulation surface — never a real server contract. QUEUED is
 * accepted here even though it is not a distinct local `SequenceExecutionStatus`
 * (it is always a `serverStatus` nested under local ACCEPTED, per
 * RefreshExecutionStatusUseCase's own LOCAL_STATUS_FOR_SERVER_STATUS
 * mapping) — the simulation tool mirrors that exact mapping rather than
 * inventing a new local state.
 */
export const SIMULATABLE_EXECUTION_STATES = ['ACCEPTED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'REJECTED'] as const;
export type SimulatableExecutionState = (typeof SIMULATABLE_EXECUTION_STATES)[number];

export class SimulateExecutionStateDto {
  @ApiProperty({ enum: SIMULATABLE_EXECUTION_STATES })
  @IsIn(SIMULATABLE_EXECUTION_STATES)
  status!: SimulatableExecutionState;

  /** Only meaningful for FAILED/REJECTED; ignored otherwise. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  errorCode?: string;

  /** Only meaningful for FAILED/REJECTED; ignored otherwise. Sanitized (trimmed, length-capped) before storage. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  errorMessage?: string;
}
