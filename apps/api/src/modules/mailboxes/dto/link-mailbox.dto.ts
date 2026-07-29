import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Fase 2.1 — the single "intención completa" body for POST /mailboxes/link.
 * Never accepts client/domain/email/serverMailboxId/status as trusted
 * input — those are resolved exclusively from the motor's own redemption
 * response, never from the browser.
 */
export class LinkMailboxDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  primaryExecutiveId!: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  secondaryExecutiveIds?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  correlationId?: string;
}
