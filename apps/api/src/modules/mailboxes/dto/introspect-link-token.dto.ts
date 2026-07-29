import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Fase 2.1 — Paso 1 of "Vincular cuenta con token". Read-only: never redeems, never creates anything. */
export class IntrospectLinkTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;
}
