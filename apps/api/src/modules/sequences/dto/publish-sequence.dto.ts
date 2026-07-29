import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

const SCENARIOS = ['SUCCESS', 'FAILED', 'TIMEOUT'] as const;

/**
 * Fase 2, Caso C — the idempotency key moved to the required `Idempotency-Key`
 * header (see PublishSequenceUseCase), matching Casos A/B: it is generated
 * once by the client and never a body field the server could be tempted to
 * regenerate.
 */
export class PublishSequenceDto {
  /** §23/§26 — lets the demo force a failed/timed-out publish; defaults to SUCCESS. */
  @ApiPropertyOptional({ enum: SCENARIOS })
  @IsOptional()
  @IsIn(SCENARIOS)
  scenario?: (typeof SCENARIOS)[number];
}
