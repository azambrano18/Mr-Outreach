import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/** Fase 2, Caso D — the idempotency key moved to the required `Idempotency-Key` header (see RemoveContactFromSequenceUseCase). */
export class RemoveSequenceContactDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}
