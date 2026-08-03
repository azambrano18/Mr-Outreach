import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsValidTemplateText } from '../../templates/validators/valid-template-text.decorator';

const MAX_HTML_LENGTH = 50_000;

export class UpdateSignatureDto {
  /**
   * Deliberately no `@IsNotEmpty()` here — a signature is valid with an
   * image alone (`<img src="...">`, no visible text), which is not an
   * empty string but also isn't "non-empty" in any meaningful sense
   * `class-validator` could check without understanding HTML. The real
   * "is this actually blank" check happens in SignaturesService, AFTER
   * sanitization (see `hasVisibleSignatureContent`) — checking raw,
   * unsanitized HTML here would also wrongly accept content that
   * sanitization is about to strip down to nothing (e.g. an image from an
   * unauthorized host).
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
