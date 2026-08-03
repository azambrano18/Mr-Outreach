import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsValidTemplateText } from '../../templates/validators/valid-template-text.decorator';

const MAX_HTML_LENGTH = 50_000;

export class CreateSignatureDto {
  /**
   * Deliberately no `@IsNotEmpty()` — see UpdateSignatureDto's comment on
   * `htmlContent` for why: the real blankness check happens server-side,
   * after sanitization, in SignaturesService.
   */
  @ApiProperty({ description: 'Sanitized server-side. May include {variable} placeholders.' })
  @IsString()
  @MaxLength(MAX_HTML_LENGTH)
  @IsValidTemplateText({ message: 'La firma tiene una variable con formato inválido.' })
  htmlContent!: string;

  @ApiPropertyOptional({
    description: 'Auto-generated from htmlContent when omitted; editable independently.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_HTML_LENGTH)
  @IsValidTemplateText({ message: 'La firma tiene una variable con formato inválido.' })
  plainTextContent?: string;
}
