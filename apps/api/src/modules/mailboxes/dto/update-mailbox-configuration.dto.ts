import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { UpdateProtocolConfigDto } from './protocol-config.dto';

/**
 * Fase 2 — the single "intención completa" body for
 * `PATCH /mailboxes/:id/configure`, replacing the frontend-coordinated
 * update+provision+advance sequence. Every field is optional and means
 * "leave unchanged" when the key is absent from the request body — never
 * confuse that with an explicit empty value, which means "apply this
 * change" (see UpdateMailboxConfigurationUseCase's field-by-field rules).
 */
export class UpdateMailboxConfigurationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fromName?: string;

  @ApiPropertyOptional({ description: 'null clears Reply-To; omit to leave it unchanged.' })
  @IsOptional()
  @IsEmail()
  replyTo?: string | null;

  @ApiPropertyOptional({ type: UpdateProtocolConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateProtocolConfigDto)
  imap?: UpdateProtocolConfigDto;

  @ApiPropertyOptional({ type: UpdateProtocolConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateProtocolConfigDto)
  smtp?: UpdateProtocolConfigDto;

  @ApiPropertyOptional({
    description:
      'Omit to leave the signature untouched. An empty/whitespace-only value archives the current signature. Sanitized server-side.',
  })
  @IsOptional()
  @IsString()
  signatureHtml?: string | null;

  @ApiPropertyOptional({ description: 'Omit both this and secondaryExecutiveIds to leave assignments untouched.' })
  @IsOptional()
  @IsString()
  primaryExecutiveId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  secondaryExecutiveIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  correlationId?: string;
}
