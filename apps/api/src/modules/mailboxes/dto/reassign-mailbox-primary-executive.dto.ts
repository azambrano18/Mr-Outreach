import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Fase 2.1, §13 — never requires a token; never changes client/domain/email. */
export class ReassignMailboxPrimaryExecutiveDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  newPrimaryExecutiveId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  correlationId?: string;
}
