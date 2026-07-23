import { ApiPropertyOptional } from '@nestjs/swagger';
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
import {
  DelayUnit,
  SequenceStepStatus,
  StepSendMode,
} from '../../../domain/sequence/sequence-step.entity';
import { IsValidTemplateText } from '../../templates/validators/valid-template-text.decorator';

const DELAY_UNITS: DelayUnit[] = ['MINUTES', 'HOURS', 'DAYS', 'BUSINESS_DAYS'];
const SEND_MODES: StepSendMode[] = ['NEW_THREAD', 'REPLY'];
const STEP_STATUSES: SequenceStepStatus[] = ['DRAFT', 'PUBLISHED', 'DISABLED', 'ARCHIVED'];
const MAX_HTML_LENGTH = 100_000;
/** No line breaks or tabs — section 10 ("no permitir saltos de línea / caracteres de control"). */
const NO_CONTROL_CHARS = /^[^\r\n\t]*$/;

export class UpdateSequenceStepDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(NO_CONTROL_CHARS, { message: 'El asunto no puede contener saltos de línea.' })
  @IsValidTemplateText({ message: 'El asunto tiene una variable con formato inválido.' })
  subject?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(NO_CONTROL_CHARS, { message: 'El preheader no puede contener saltos de línea.' })
  @IsValidTemplateText({ message: 'El preheader tiene una variable con formato inválido.' })
  preheader?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_HTML_LENGTH)
  @IsValidTemplateText({ message: 'El header tiene una variable con formato inválido.' })
  htmlHeader?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_HTML_LENGTH)
  @IsValidTemplateText({ message: 'El cuerpo tiene una variable con formato inválido.' })
  htmlBody?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_HTML_LENGTH)
  @IsValidTemplateText({ message: 'El texto plano tiene una variable con formato inválido.' })
  plainTextBody?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 90 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  delayValue?: number;

  @ApiPropertyOptional({ enum: DELAY_UNITS })
  @IsOptional()
  @IsIn(DELAY_UNITS)
  delayUnit?: DelayUnit;

  @ApiPropertyOptional({ enum: SEND_MODES })
  @IsOptional()
  @IsIn(SEND_MODES)
  sendMode?: StepSendMode;

  @ApiPropertyOptional({ enum: STEP_STATUSES })
  @IsOptional()
  @IsIn(STEP_STATUSES)
  status?: SequenceStepStatus;
}
