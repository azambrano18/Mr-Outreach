import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/** Fase 2, Caso E — the idempotency key moved to the required `Idempotency-Key` header (see RemoveCompanyFromSequenceUseCase). */
export class RemoveSequenceCompanyDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}
