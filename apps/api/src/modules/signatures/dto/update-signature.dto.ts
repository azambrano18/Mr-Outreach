import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsValidTemplateText } from '../../templates/validators/valid-template-text.decorator';

const MAX_HTML_LENGTH = 50_000;

export class UpdateSignatureDto {
  @ApiProperty({ description: 'Sanitized server-side. May include {variable} placeholders.' })
  @IsString()
  @IsNotEmpty()
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
