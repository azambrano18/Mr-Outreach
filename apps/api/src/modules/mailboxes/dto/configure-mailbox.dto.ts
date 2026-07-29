import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ProtocolConfigDto } from './protocol-config.dto';

/**
 * Fase 2, Caso A — the single "intención completa" body for
 * POST /admin/mailboxes/configure. Never accepts name/rut/rubro/estado del
 * CRM (only `crmClientId`, trusted only to look the real client up) — same
 * rule as ActivateClientDto since Fase 1.5.
 */
export class ConfigureMailboxDto {
  @ApiProperty()
  @IsInt()
  crmClientId!: number;

  @ApiProperty({ description: 'e.g. "ventas.cl"' })
  @IsString()
  @IsNotEmpty()
  domainName!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fromName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  replyTo?: string;

  @ApiProperty({ type: ProtocolConfigDto })
  @ValidateNested()
  @Type(() => ProtocolConfigDto)
  imap!: ProtocolConfigDto;

  @ApiProperty({ type: ProtocolConfigDto })
  @ValidateNested()
  @Type(() => ProtocolConfigDto)
  smtp!: ProtocolConfigDto;

  @ApiPropertyOptional({ description: 'Sanitized server-side; plain-text fallback auto-generated.' })
  @IsOptional()
  @IsString()
  signatureHtml?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  primaryExecutiveId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  secondaryExecutiveIds?: string[];
}
