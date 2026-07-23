import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DelayUnit, StepSendMode } from '../../../domain/sequence/sequence-step.entity';
import { IsValidTemplateText } from '../../templates/validators/valid-template-text.decorator';

const DELAY_UNITS: DelayUnit[] = ['MINUTES', 'HOURS', 'DAYS', 'BUSINESS_DAYS'];
const SEND_MODES: StepSendMode[] = ['NEW_THREAD', 'REPLY'];
const MAX_HTML_LENGTH = 100_000;
/** No line breaks or tabs — section 10 ("no permitir saltos de línea / caracteres de control"). */
const NO_CONTROL_CHARS = /^[^\r\n\t]*$/;

export class CreateSequenceStepDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'May include {variable} placeholders. No line breaks.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(NO_CONTROL_CHARS, { message: 'El asunto no puede contener saltos de línea.' })
  @IsValidTemplateText({ message: 'El asunto tiene una variable con formato inválido.' })
  subject!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(NO_CONTROL_CHARS, { message: 'El preheader no puede contener saltos de línea.' })
  @IsValidTemplateText({ message: 'El preheader tiene una variable con formato inválido.' })
  preheader?: string;

  @ApiPropertyOptional({
    description: '§5 — optional, independent-per-step header shown before the body. Sanitized server-side.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_HTML_LENGTH)
  @IsValidTemplateText({ message: 'El header tiene una variable con formato inválido.' })
  htmlHeader?: string | null;

  @ApiProperty({ description: 'Sanitized server-side. May include {variable} placeholders.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_HTML_LENGTH)
  @IsValidTemplateText({ message: 'El cuerpo tiene una variable con formato inválido.' })
  htmlBody!: string;

  @ApiPropertyOptional({
    description: 'Auto-generated from htmlBody when omitted; editable independently.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_HTML_LENGTH)
  @IsValidTemplateText({ message: 'El texto plano tiene una variable con formato inválido.' })
  plainTextBody?: string;

  @ApiProperty({ minimum: 0, maximum: 90 })
  @IsInt()
  @Min(0)
  @Max(90)
  delayValue!: number;

  @ApiProperty({ enum: DELAY_UNITS })
  @IsIn(DELAY_UNITS)
  delayUnit!: DelayUnit;

  @ApiProperty({ enum: SEND_MODES })
  @IsIn(SEND_MODES)
  sendMode!: StepSendMode;
}
